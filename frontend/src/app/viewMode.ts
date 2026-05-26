import type { Editor } from '@tiptap/core'
import { getMarkdown, setMarkdown } from '../editor/serialize/markdown'
import { createSourceView, type SourceView } from '../editor/sourceView'

export type ViewMode = 'hybrid' | 'source'

export interface ViewController {
  readonly mode: ViewMode
  setMode(mode: ViewMode): void
  toggle(): void
  getCurrentMarkdown(): string
  loadMarkdown(text: string): void
  focus(): void
  onModeChange(fn: () => void): () => void
  onContentChange(fn: () => void): () => void
}

export interface CreateViewControllerOptions {
  editor: Editor
  hybridContainer: HTMLElement
  sourceParent: HTMLElement
}

export function createViewController(opts: CreateViewControllerOptions): ViewController {
  let mode: ViewMode = 'hybrid'
  let sourceView: SourceView | null = null
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
    opts.hybridContainer.style.display = 'none'
    opts.sourceParent.style.display = ''
    sourceView = createSourceView({
      parent: opts.sourceParent,
      doc: md,
      onUpdate: () => notifyContent(),
    })
    sourceView.focus()
  }

  function exitSource(): void {
    const md = sourceView?.getValue() ?? ''
    sourceView?.destroy()
    sourceView = null
    opts.sourceParent.style.display = 'none'
    opts.hybridContainer.style.display = ''
    setMarkdown(opts.editor, md)
    opts.editor.commands.focus()
  }

  function setMode(next: ViewMode): void {
    if (next === mode) return
    if (next === 'source') enterSource()
    else exitSource()
    mode = next
    notifyMode()
  }

  return {
    get mode(): ViewMode {
      return mode
    },
    setMode,
    toggle: () => setMode(mode === 'hybrid' ? 'source' : 'hybrid'),
    getCurrentMarkdown: () =>
      mode === 'hybrid' ? getMarkdown(opts.editor) : (sourceView?.getValue() ?? ''),
    loadMarkdown: (text: string) => {
      if (mode === 'hybrid') setMarkdown(opts.editor, text)
      else sourceView?.setValue(text)
    },
    focus: () => {
      if (mode === 'hybrid') opts.editor.commands.focus()
      else sourceView?.focus()
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
