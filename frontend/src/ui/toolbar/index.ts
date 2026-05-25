import type { Editor } from '@tiptap/core'
import { commands } from '../../commands/registry'
import './toolbar.css'

interface ToolbarBinding {
  command: string
  isActive?: (editor: Editor) => boolean
}

const bindings: Record<string, ToolbarBinding> = {
  'tb-bold': { command: 'format.bold', isActive: (e) => e.isActive('bold') },
  'tb-italic': { command: 'format.italic', isActive: (e) => e.isActive('italic') },
  'tb-strike': { command: 'format.strike', isActive: (e) => e.isActive('strike') },
  'tb-code': { command: 'format.code', isActive: (e) => e.isActive('code') },
  'tb-h1': { command: 'format.heading1', isActive: (e) => e.isActive('heading', { level: 1 }) },
  'tb-h2': { command: 'format.heading2', isActive: (e) => e.isActive('heading', { level: 2 }) },
  'tb-h3': { command: 'format.heading3', isActive: (e) => e.isActive('heading', { level: 3 }) },
  'tb-ul': { command: 'format.bulletList', isActive: (e) => e.isActive('bulletList') },
  'tb-ol': { command: 'format.orderedList', isActive: (e) => e.isActive('orderedList') },
  'tb-quote': { command: 'format.blockquote', isActive: (e) => e.isActive('blockquote') },
  'tb-codeblock': { command: 'format.codeBlock', isActive: (e) => e.isActive('codeBlock') },
  'tb-hr': { command: 'format.horizontalRule' },
  'tb-link': { command: 'insert.link' },
  'tb-image': { command: 'insert.image' },
  'tb-undo': { command: 'edit.undo' },
  'tb-redo': { command: 'edit.redo' },
}

export function mountToolbar(editor: Editor): { refresh: () => void } {
  for (const [id, binding] of Object.entries(bindings)) {
    const el = document.getElementById(id)
    if (!el) continue
    el.addEventListener('click', () => commands.execute(binding.command))
  }

  const refresh = (): void => {
    for (const [id, binding] of Object.entries(bindings)) {
      if (!binding.isActive) continue
      document.getElementById(id)?.classList.toggle('is-active', binding.isActive(editor))
    }
  }

  return { refresh }
}
