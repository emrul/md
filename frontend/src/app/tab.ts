import type { Editor } from '@tiptap/core'
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
