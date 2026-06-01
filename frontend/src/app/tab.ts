import type { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import { clearEditorHistory } from '../editor/historyControl'
import type { ViewController } from './viewMode'

type Listener = () => void

export interface LinkController {
  requestLink(): boolean
}

export interface TabDom {
  /** Outer per-tab container; visibility toggled via `.is-hidden` */
  mount: HTMLElement
  /** Container for the TipTap editor — passed as `element` to `createEditor` */
  editorElement: HTMLElement
  /** Scroll wrapper used by canvasClick and the hybrid view */
  hybridContainer: HTMLElement
  /** Sibling created lazily for the source view */
  sourceParent: HTMLElement
  /** Per-tab bubble menu root; appended to document.body */
  bubbleMount: HTMLElement
}

export interface TabDisposables {
  destroy(): void
}

/** The cheap stat the external-change poll gates re-reads on (see fileSync.ts). */
export interface DiskStat {
  modTimeMs: number
  size: number
}

/**
 * A single open document. Holds everything that belongs to one document:
 * file path, dirty flag, the TipTap editor (with its own undo history),
 * the view controller, and the DOM mount points.
 */
export class Tab {
  filePath: string | null = null
  modified = false
  /**
   * Absolute path of the enclosing git repo root for this tab's file, or
   * null when the file isn't inside a repo (or no file is open). Set
   * asynchronously after the path resolves via FindGitRoot.
   */
  gitRoot: string | null = null
  /** Current branch name of gitRoot (or short commit hash if detached);
   * null when not in a repo. Shown in the footer. */
  gitBranch: string | null = null
  linkController: LinkController | null = null
  viewController: ViewController | null = null
  /** Per-tab UI handles (bubble menu, lang picker, table toolbar) registered after construction */
  disposables: TabDisposables[] = []
  /**
   * Markdown waiting to be loaded into the editor on first activation. Set
   * when a tab is opened with `defer: true` (e.g. multi-file open); cleared
   * to null once the content has been pushed into TipTap.
   */
  pendingContent: string | null = null
  /**
   * Exact bytes last read from / written to disk for this file. The baseline the
   * external-change check diffs a fresh read against — NOT `savedMarkdown`, which
   * is the normalized round-trip and can differ from the raw file. Empty until a
   * file is loaded/saved (Untitled tabs never sync). See fileSync.ts.
   */
  diskContent = ''
  /** Last stat seen for `filePath`; the cheap gate before re-reading. Managed by
   * fileSync; reset to null on load/save so the next check re-establishes it. */
  diskStat: DiskStat | null = null
  /**
   * Set when this tab's file changed on disk while the buffer had unsaved edits —
   * carries the disk bytes for the resolve banner / diff. Null when in sync.
   * A clean tab reloads in place instead of setting this.
   */
  externalChange: { diskContent: string } | null = null
  /**
   * History depth at the last "saved" point: load or successful write. Used as
   * a cheap fast-path for the clean check (matching depth ⇒ definitely clean).
   */
  savedAtDepth = 0
  /**
   * The markdown serialized at the last save/load. Dirty is ultimately defined
   * against this (markdown is the source of truth) — not against history depth —
   * so a render-mode switch, which is an undoable transaction but a content-
   * neutral round-trip, doesn't falsely mark the tab dirty.
   */
  private savedMarkdown = ''
  private listeners: Set<Listener> = new Set()

  constructor(
    public readonly id: string,
    public readonly editor: Editor,
    public readonly dom: TabDom,
  ) {}

  getCurrentMarkdown(): string {
    return this.viewController?.getCurrentMarkdown() ?? ''
  }

  loadMarkdown(text: string): void {
    this.viewController?.loadMarkdown(text)
  }

  fileName(): string {
    return this.filePath ? this.filePath.replace(/.*[/\\]/, '') : 'Untitled.md'
  }

  setFilePath(path: string | null): void {
    this.filePath = path
    this.notify()
  }

  /** Set git root + branch together and notify (the footer reflects both). */
  setGit(root: string | null, branch: string | null): void {
    this.gitRoot = root
    this.gitBranch = branch
    this.notify()
  }

  setModified(value: boolean): void {
    this.modified = value
    this.notify()
  }

  /** Called after loading content from disk (or creating an empty tab). Clears
   * editor history so the load isn't undoable, baselines the dirty tracker, and
   * records `diskContent` as the on-disk truth (the RAW bytes loaded, which the
   * external-change check diffs against — distinct from the normalized
   * `savedMarkdown`). Pass the raw bytes; defaults to empty for a blank tab. */
  markLoaded(diskContent = ''): void {
    clearEditorHistory(this.editor)
    this.savedAtDepth = 0
    this.savedMarkdown = this.getCurrentMarkdown()
    this.diskContent = diskContent
    this.diskStat = null
    this.externalChange = null
    this.setModified(false)
  }

  /** Called after a successful write to disk. Pins the current depth + markdown
   * as the new clean baseline. We wrote exactly `savedMarkdown`, so that IS the
   * new on-disk content — recording it lets the next external-change check
   * recognise our own save and skip a reload. */
  markSaved(): void {
    this.savedAtDepth = undoDepth(this.editor.state)
    this.savedMarkdown = this.getCurrentMarkdown()
    this.diskContent = this.savedMarkdown
    this.diskStat = null
    this.externalChange = null
    this.setModified(false)
  }

  /** Flag that the file changed on disk underneath unsaved edits. Drives the
   * resolve banner (and the pro disk-vs-working diff). */
  flagExternalChange(diskContent: string): void {
    this.externalChange = { diskContent }
    this.notify()
  }

  /** Dismiss the external-change flag (the buffer wins until the next save). */
  clearExternalChange(): void {
    if (!this.externalChange) return
    this.externalChange = null
    this.notify()
  }

  /** Reload the buffer from disk in place, re-baselining as clean. Best-effort:
   * preserves caret + scroll for the editor views (the source view rebuilds its
   * own state); the content changed, so positions are clamped to the new doc. */
  reloadFromDisk(content: string): void {
    const inSource = this.viewController?.mode === 'source'
    const caret = inSource ? 0 : this.editor.state.selection.from
    const scrollEl = this.dom.hybridContainer
    const scrollTop = scrollEl?.scrollTop ?? 0

    this.loadMarkdown(content)
    this.markLoaded(content)

    if (!inSource) {
      const size = this.editor.state.doc.content.size
      const pos = Math.min(Math.max(1, caret), Math.max(1, size - 1))
      try {
        this.editor.commands.setTextSelection(pos)
      } catch {
        /* clamp landed on a non-text position — harmless, leave the caret */
      }
      if (scrollEl) scrollEl.scrollTop = Math.min(scrollTop, scrollEl.scrollHeight)
    }
  }

  /** True when the document matches the last save/load. The history-depth match
   * is a cheap fast-path (definitely clean) for the editor views; otherwise fall
   * back to comparing the serialized markdown, so content-neutral transactions
   * like a render-mode switch (an undoable round-trip) don't read as dirty.
   *
   * In source mode the fast path is SKIPPED: edits live in CodeMirror, so the PM
   * undo depth never moves and the fast path would wrongly report "clean" —
   * which would let an external-change reload clobber unsaved source edits. The
   * markdown comparison is authoritative there. */
  isAtSavedState(): boolean {
    const inSource = this.viewController?.mode === 'source'
    if (!inSource && undoDepth(this.editor.state) === this.savedAtDepth) return true
    return this.getCurrentMarkdown() === this.savedMarkdown
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  notify(): void {
    for (const fn of this.listeners) fn()
  }

  destroy(): void {
    for (const d of this.disposables) d.destroy()
    this.disposables = []
    this.editor.destroy()
    this.dom.mount.remove()
    this.dom.bubbleMount.remove()
    this.listeners.clear()
  }
}
