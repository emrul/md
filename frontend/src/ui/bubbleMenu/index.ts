import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Workspace } from '../../app/workspace'
import { commands } from '../../commands/registry'
import './bubble-menu.css'

interface ButtonSpec {
  id: string
  label: string
  cmd: string
  title: string
  cls?: string
  isActive?: (editor: Editor) => boolean
}

const BUTTONS: ButtonSpec[] = [
  {
    id: 'bm-bold',
    label: 'B',
    cmd: 'format.bold',
    title: 'Bold (⌘B)',
    cls: 'bm-btn-bold',
    isActive: (e) => e.isActive('bold'),
  },
  {
    id: 'bm-italic',
    label: 'I',
    cmd: 'format.italic',
    title: 'Italic (⌘I)',
    cls: 'bm-btn-italic',
    isActive: (e) => e.isActive('italic'),
  },
  {
    id: 'bm-strike',
    label: 'S',
    cmd: 'format.strike',
    title: 'Strikethrough',
    cls: 'bm-btn-strike',
    isActive: (e) => e.isActive('strike'),
  },
  {
    id: 'bm-code',
    label: '<>',
    cmd: 'format.code',
    title: 'Inline code (⌘E)',
    cls: 'bm-btn-code',
    isActive: (e) => e.isActive('code'),
  },
  {
    id: 'bm-link',
    label: 'Link',
    cmd: 'insert.link',
    title: 'Link (⌘K)',
    isActive: (e) => e.isActive('link'),
  },
  {
    id: 'bm-clear',
    label: 'Clear',
    cmd: 'format.clearAll',
    title: 'Clear formatting',
  },
]

let linkMode = false

interface ShouldShowProps {
  editor: Editor
  element: HTMLElement
  view: EditorView
  state: EditorState
  from: number
  to: number
}

export function bubbleMenuShouldShow(props: ShouldShowProps): boolean {
  const isChildOfMenu = props.element.contains(document.activeElement)
  const hasEditorFocus = props.view.hasFocus() || isChildOfMenu
  if (!hasEditorFocus) return false
  if (linkMode) return true
  if (props.from === props.to) return false
  const node = props.state.doc.nodeAt(props.from)
  if (node?.type.name === 'codeBlock') return false
  return true
}

export interface BubbleMenuRefs {
  root: HTMLElement
  buttonsRow: HTMLElement
  buttons: Record<string, HTMLButtonElement>
  linkRow: HTMLElement
  linkInput: HTMLInputElement
  linkApply: HTMLButtonElement
  linkRemove: HTMLButtonElement
  linkCancel: HTMLButtonElement
}

export function createBubbleMenu(): BubbleMenuRefs {
  const root = document.createElement('div')
  root.className = 'bubble-menu'

  const buttonsRow = document.createElement('div')
  buttonsRow.className = 'bm-row bm-row-buttons'

  const buttons: Record<string, HTMLButtonElement> = {}
  for (const b of BUTTONS) {
    if (b.id === 'bm-link' || b.id === 'bm-clear') {
      const sep = document.createElement('span')
      sep.className = 'bm-sep'
      buttonsRow.appendChild(sep)
    }
    const btn = document.createElement('button')
    btn.id = b.id
    btn.className = 'bm-btn' + (b.cls ? ' ' + b.cls : '')
    btn.textContent = b.label
    btn.title = b.title
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      commands.execute(b.cmd)
    })
    buttons[b.id] = btn
    buttonsRow.appendChild(btn)
  }

  const linkRow = document.createElement('div')
  linkRow.className = 'bm-row bm-row-link'
  linkRow.style.display = 'none'

  const linkInput = document.createElement('input')
  linkInput.type = 'url'
  linkInput.placeholder = 'https://…'
  linkInput.className = 'bm-link-input'
  linkInput.setAttribute('aria-label', 'Link URL')

  const ICON_CHECK =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 8.5 6.5 12 13 4.5"/></svg>'
  const ICON_UNLINK =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h2.5a3.5 3.5 0 0 1 0 7H10"/><path d="M7 12H4.5a3.5 3.5 0 0 1 0-7H6"/><line x1="2.5" y1="13.5" x2="13.5" y2="2.5"/></svg>'
  const ICON_X =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>'

  const linkApply = document.createElement('button')
  linkApply.className = 'bm-btn bm-btn-icon bm-btn-primary'
  linkApply.innerHTML = ICON_CHECK
  linkApply.title = 'Apply (Enter)'
  linkApply.setAttribute('aria-label', 'Apply link')

  const linkRemove = document.createElement('button')
  linkRemove.className = 'bm-btn bm-btn-icon'
  linkRemove.innerHTML = ICON_UNLINK
  linkRemove.title = 'Remove link'
  linkRemove.setAttribute('aria-label', 'Remove link')

  const linkCancel = document.createElement('button')
  linkCancel.className = 'bm-btn bm-btn-icon'
  linkCancel.innerHTML = ICON_X
  linkCancel.title = 'Cancel (Esc)'
  linkCancel.setAttribute('aria-label', 'Cancel')

  linkRow.append(linkInput, linkApply, linkRemove, linkCancel)
  root.append(buttonsRow, linkRow)

  return { root, buttonsRow, buttons, linkRow, linkInput, linkApply, linkRemove, linkCancel }
}

export function bindBubbleMenu(refs: BubbleMenuRefs, ws: Workspace): void {
  const editor = ws.editor

  const enterLinkMode = (): void => {
    linkMode = true
    const existingHref = (editor.getAttributes('link').href as string | undefined) ?? ''
    refs.linkInput.value = existingHref
    refs.buttonsRow.style.display = 'none'
    refs.linkRow.style.display = ''
    requestAnimationFrame(() => {
      refs.linkInput.focus()
      refs.linkInput.select()
    })
  }

  const exitLinkMode = (refocusEditor: boolean): void => {
    if (!linkMode) return
    linkMode = false
    refs.linkRow.style.display = 'none'
    refs.buttonsRow.style.display = ''
    if (refocusEditor) editor.commands.focus()
  }

  const applyLink = (): void => {
    const url = refs.linkInput.value.trim()
    if (!url) {
      editor.chain().focus().unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
    exitLinkMode(false)
  }

  const removeLink = (): void => {
    editor.chain().focus().unsetLink().run()
    exitLinkMode(false)
  }

  const cancelLink = (): void => {
    exitLinkMode(true)
  }

  refs.linkApply.addEventListener('mousedown', (e) => {
    e.preventDefault()
    applyLink()
  })
  refs.linkRemove.addEventListener('mousedown', (e) => {
    e.preventDefault()
    removeLink()
  })
  refs.linkCancel.addEventListener('mousedown', (e) => {
    e.preventDefault()
    cancelLink()
  })

  refs.linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      applyLink()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelLink()
    }
  })

  const refresh = (): void => {
    if (linkMode) exitLinkMode(false)
    for (const b of BUTTONS) {
      const btn = refs.buttons[b.id]
      if (btn && b.isActive) btn.classList.toggle('is-active', b.isActive(editor))
    }
  }
  editor.on('selectionUpdate', refresh)
  editor.on('update', refresh)
  refresh()

  ws.linkController = {
    requestLink: () => {
      if (editor.state.selection.empty) return false
      enterLinkMode()
      return true
    },
  }
}
