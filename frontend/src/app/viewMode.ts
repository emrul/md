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
  /**
   * Mount a read-only overlay covering the editor/source view (generic — the
   * commercial overlay uses it for the diff view, but nothing here knows about
   * diffs). Hides the active view, shows `content`, binds Esc → close, and
   * focuses it. Opening while another overlay is open replaces it. The overlay
   * is orthogonal to `mode`; switching mode (or `toggle`) closes it first.
   */
  openReadonlyOverlay(content: HTMLElement, opts?: { onClose?: () => void }): void
  /** Close the read-only overlay and restore the view for the current mode. */
  closeReadonlyOverlay(): void
  /** True while a read-only overlay is mounted. */
  readonly overlayOpen: boolean
  onOverlayChange(fn: () => void): () => void
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
  const overlayListeners = new Set<() => void>()

  // Read-only overlay (e.g. the pro diff view). Orthogonal to `mode`: it covers
  // whichever view is active and restores it on close.
  let overlayEl: HTMLElement | null = null
  let overlayOnClose: (() => void) | undefined
  let overlayKeydown: ((e: KeyboardEvent) => void) | undefined

  opts.sourceParent.style.display = 'none'

  function notifyMode(): void {
    for (const fn of modeListeners) fn()
  }
  function notifyContent(): void {
    for (const fn of contentListeners) fn()
  }
  function notifyOverlay(): void {
    for (const fn of overlayListeners) fn()
  }

  // Show the view that belongs to the current mode (used after closing an
  // overlay). In source mode the CodeMirror parent is visible; otherwise the
  // editor's scroll wrapper is.
  function showActiveView(): void {
    const inSource = mode === 'source'
    opts.hybridContainer.style.display = inSource ? 'none' : ''
    opts.sourceParent.style.display = inSource ? '' : 'none'
  }

  function openReadonlyOverlay(content: HTMLElement, o?: { onClose?: () => void }): void {
    closeReadonlyOverlay()
    const parent = opts.hybridContainer.parentElement
    if (!parent) return
    opts.hybridContainer.style.display = 'none'
    opts.sourceParent.style.display = 'none'
    overlayEl = content
    overlayOnClose = o?.onClose
    if (content.tabIndex < 0) content.tabIndex = -1
    parent.appendChild(content)
    // Esc closes. Bound on the element (not document) so it's torn down with the
    // overlay and can't leak past a tab close.
    overlayKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeReadonlyOverlay()
      }
    }
    content.addEventListener('keydown', overlayKeydown)
    content.focus()
    notifyOverlay()
  }

  function closeReadonlyOverlay(): void {
    if (!overlayEl) return
    if (overlayKeydown) overlayEl.removeEventListener('keydown', overlayKeydown)
    overlayKeydown = undefined
    overlayEl.remove()
    overlayEl = null
    const cb = overlayOnClose
    overlayOnClose = undefined
    showActiveView()
    if (mode === 'source') sourceView?.focus()
    else opts.editor.commands.focus()
    notifyOverlay()
    cb?.()
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
    // A read-only overlay is orthogonal to mode; tear it down before any switch
    // so source⇄diff⇄source transitions don't fight over which view is visible.
    if (overlayEl) closeReadonlyOverlay()
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
    openReadonlyOverlay,
    closeReadonlyOverlay,
    get overlayOpen(): boolean {
      return overlayEl !== null
    },
    onOverlayChange: (fn) => {
      overlayListeners.add(fn)
      return () => overlayListeners.delete(fn)
    },
  }
}
