import type { Editor } from '@tiptap/core'
import type { Workspace } from '../../app/workspace'
import { commands } from '../../commands/registry'
import './toolbar.css'

interface ToolbarBinding {
  command: string
  isActive?: (editor: Editor) => boolean
  // If true, this button is a formatting action that requires hybrid mode.
  // Buttons without this flag (undo, redo, source toggle) always work.
  formatting?: boolean
}

const bindings: Record<string, ToolbarBinding> = {
  'tb-bold': {
    command: 'format.bold',
    isActive: (e) => e.isActive('bold'),
    formatting: true,
  },
  'tb-italic': {
    command: 'format.italic',
    isActive: (e) => e.isActive('italic'),
    formatting: true,
  },
  'tb-strike': {
    command: 'format.strike',
    isActive: (e) => e.isActive('strike'),
    formatting: true,
  },
  'tb-code': {
    command: 'format.code',
    isActive: (e) => e.isActive('code'),
    formatting: true,
  },
  'tb-h1': {
    command: 'format.heading1',
    isActive: (e) => e.isActive('heading', { level: 1 }),
    formatting: true,
  },
  'tb-h2': {
    command: 'format.heading2',
    isActive: (e) => e.isActive('heading', { level: 2 }),
    formatting: true,
  },
  'tb-h3': {
    command: 'format.heading3',
    isActive: (e) => e.isActive('heading', { level: 3 }),
    formatting: true,
  },
  'tb-ul': {
    command: 'format.bulletList',
    isActive: (e) => e.isActive('bulletList'),
    formatting: true,
  },
  'tb-ol': {
    command: 'format.orderedList',
    isActive: (e) => e.isActive('orderedList'),
    formatting: true,
  },
  'tb-quote': {
    command: 'format.blockquote',
    isActive: (e) => e.isActive('blockquote'),
    formatting: true,
  },
  'tb-codeblock': {
    command: 'format.codeBlock',
    isActive: (e) => e.isActive('codeBlock'),
    formatting: true,
  },
  'tb-hr': { command: 'format.horizontalRule', formatting: true },
  'tb-link': { command: 'insert.link', formatting: true },
  'tb-image': { command: 'insert.image', formatting: true },
  'tb-undo': { command: 'edit.undo' },
  'tb-redo': { command: 'edit.redo' },
  'tb-source': { command: 'view.toggleSource' },
}

export function mountToolbar(ws: Workspace): { refresh: () => void } {
  const editor = ws.editor

  for (const [id, binding] of Object.entries(bindings)) {
    const el = document.getElementById(id)
    if (!el) continue
    el.addEventListener('click', () => {
      if (binding.formatting && ws.viewController?.mode === 'source') return
      commands.execute(binding.command)
    })
  }

  const refresh = (): void => {
    const isSource = ws.viewController?.mode === 'source'
    for (const [id, binding] of Object.entries(bindings)) {
      const el = document.getElementById(id)
      if (!el) continue
      if (binding.formatting) {
        el.classList.toggle('is-disabled', isSource)
      }
      if (binding.isActive) {
        const active = !isSource && binding.isActive(editor)
        el.classList.toggle('is-active', active)
      }
    }
    const sourceBtn = document.getElementById('tb-source')
    sourceBtn?.classList.toggle('is-active', isSource)
  }

  return { refresh }
}
