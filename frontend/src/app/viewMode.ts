import type { Editor } from '@tiptap/core'
import { getMarkdown, setMarkdown } from '../editor/serialize/markdown'
import { getRenderMode, switchRenderMode, type RenderMode } from '../editor/mode'
import { createSourceView, type SourceView } from '../editor/sourceView'

// The user-facing mode. 'wysiwyg' and 'hybrid' are both the TipTap editor (the
// difference is the editor's render mode); 'source' is the CodeMirror overlay.
export type ViewMode = 'wysiwyg' | 'hybrid' | 'source'

export interface ViewController {
  readonly mode: ViewMode
  setMode(mode: ViewMode): void
  toggle(): void
  getCurrentMarkdown(): string
  loadMarkdown(text: string): void
  focus(): void
  /** Unified undo. In source view, prefer CM's own history; when empty, undo
   * the editor's history and refresh CM with the new markdown. In editor view,
   * undo the editor's history with focus. */
  undo(): boolean
  /** Symmetrical redo. */
  redo(): boolean
  onModeChange(fn: () => void): () => void
  onContentChange(fn: () => void): () => void
}

export interface CreateViewControllerOptions {
  editor: Editor
  hybridContainer: HTMLElement
  sourceParent: HTMLElement
  /** Initial mode (from the editorMode preference). Defaults to 'hybrid'. */
  initialMode?: ViewMode
}

export function createViewController(opts: CreateViewControllerOptions): ViewController {
  let mode: ViewMode = opts.initialMode ?? 'hybrid'
  // The editor mode to return to when toggling source off (⌘/).
  let lastEditorMode: RenderMode = mode === 'wysiwyg' ? 'wysiwyg' : 'hybrid'
  let sourceView: SourceView | null = null
  // The markdown synced into the source view on entry (or via loadMarkdown
  // while in source). On exit, an unchanged value means the user only "peeked"
  // at the source — we skip the re-load so the undo stack stays clean.
  let sourceBaseline: string | null = null
  const modeListeners = new Set<() => void>()
  const contentListeners = new Set<() => void>()

  opts.sourceParent.style.display = 'none'

  function notifyMode(): void {
    for (const fn of modeListeners) fn()
  }
  function notifyContent(): void {
    for (const fn of contentListeners) fn()
  }

  function enterSource(): void {
    const md = getMarkdown(opts.editor)
    sourceBaseline = md
    opts.hybridContainer.style.display = 'none'
    opts.sourceParent.style.display = ''
    sourceView = createSourceView({
      parent: opts.sourceParent,
      doc: md,
      onUpdate: () => notifyContent(),
    })
    sourceView.focus()
  }

  // Leave the source view, rebuilding the editor doc in the given render mode.
  // When the source view's bytes are unchanged from entry, skip the re-load
  // entirely so the round-trip doesn't dirty the undo stack; a target render
  // mode that differs from the editor's current one falls through to the
  // (sealed, undoable) mode-switch transaction.
  function exitSource(target: RenderMode): void {
    const md = sourceView?.getValue() ?? ''
    sourceView?.destroy()
    sourceView = null
    opts.sourceParent.style.display = 'none'
    opts.hybridContainer.style.display = ''
    const baseline = sourceBaseline ?? ''
    sourceBaseline = null
    if (md === baseline) {
      if (getRenderMode(opts.editor) !== target) switchRenderMode(opts.editor, target)
    } else {
      setMarkdown(opts.editor, md, target)
    }
    opts.editor.commands.focus()
  }

  function setMode(next: ViewMode): void {
    if (next === mode) return
    if (next === 'source') {
      enterSource()
    } else if (mode === 'source') {
      exitSource(next)
      lastEditorMode = next
    } else {
      // wysiwyg ⇄ hybrid: in-place conversion (undo preserved).
      switchRenderMode(opts.editor, next)
      lastEditorMode = next
    }
    mode = next
    notifyMode()
  }

  // If the controller starts in source mode, open the overlay up front (the
  // editor is empty until loadMarkdown, which keeps the overlay in sync).
  if (mode === 'source') enterSource()

  return {
    get mode(): ViewMode {
      return mode
    },
    setMode,
    // ⌘/ flips source on/off, returning to the last editor mode.
    toggle: () => setMode(mode === 'source' ? lastEditorMode : 'source'),
    getCurrentMarkdown: () =>
      mode === 'source' ? (sourceView?.getValue() ?? '') : getMarkdown(opts.editor),
    loadMarkdown: (text: string) => {
      if (mode === 'source') {
        // Hold content in the (hidden) editor as hybrid so exiting is cheap,
        // mirror it into the overlay, and rebase the source-view baseline so a
        // subsequent exit-without-edits still reads as a no-op.
        setMarkdown(opts.editor, text, 'hybrid')
        const md = getMarkdown(opts.editor)
        sourceView?.setValue(md)
        sourceBaseline = md
      } else {
        setMarkdown(opts.editor, text, lastEditorMode)
      }
    },
    focus: () => {
      if (mode === 'source') sourceView?.focus()
      else opts.editor.commands.focus()
    },
    undo: () => {
      if (mode !== 'source') return opts.editor.chain().focus().undo().run()
      if (sourceView?.tryUndo()) return true
      if (!opts.editor.commands.undo()) return false
      // Editor history moved; mirror the new markdown into CM and rebase the
      // baseline so a subsequent peek-and-exit still reads as a no-op.
      if (sourceView) {
        const md = getMarkdown(opts.editor)
        sourceView.setValue(md)
        sourceBaseline = md
      }
      return true
    },
    redo: () => {
      if (mode !== 'source') return opts.editor.chain().focus().redo().run()
      if (sourceView?.tryRedo()) return true
      if (!opts.editor.commands.redo()) return false
      if (sourceView) {
        const md = getMarkdown(opts.editor)
        sourceView.setValue(md)
        sourceBaseline = md
      }
      return true
    },
    onModeChange: (fn) => {
      modeListeners.add(fn)
      return () => modeListeners.delete(fn)
    },
    onContentChange: (fn) => {
      contentListeners.add(fn)
      return () => contentListeners.delete(fn)
    },
  }
}
