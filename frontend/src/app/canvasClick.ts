import type { Editor } from '@tiptap/core'

export function bindCanvasClick(editor: Editor): void {
  const editorEl = editor.options.element as HTMLElement
  const scrollEl = editorEl.closest('.editor-scroll') as HTMLElement | null
  if (!scrollEl) return

  scrollEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const pmEl = editorEl.querySelector('.ProseMirror') as HTMLElement | null
    if (!pmEl) return
    if (pmEl.contains(target)) return

    e.preventDefault()

    const pmRect = pmEl.getBoundingClientRect()
    const clampedX = Math.min(Math.max(e.clientX, pmRect.left + 4), pmRect.right - 4)
    const clampedY = Math.min(Math.max(e.clientY, pmRect.top + 1), pmRect.bottom - 1)
    const hit = editor.view.posAtCoords({ left: clampedX, top: clampedY })

    if (hit) {
      editor.chain().focus().setTextSelection(hit.pos).run()
    } else {
      editor.commands.focus('end')
    }
  })
}
