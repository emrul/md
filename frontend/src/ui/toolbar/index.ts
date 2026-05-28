import type { Editor } from '@tiptap/core'
import type { TabManager } from '../../app/tabManager'
import { commands } from '../../commands/registry'
import './toolbar.css'

// --- Icons (filled, 24×24, currentColor). Bold/Italic/Strike/Undo/Redo are
// the exact tiptap.dev reference paths; the rest are Phosphor-style fills. ---
const I_BOLD = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M6 2.5C5.17157 2.5 4.5 3.17157 4.5 4V20C4.5 20.8284 5.17157 21.5 6 21.5H15C16.4587 21.5 17.8576 20.9205 18.8891 19.8891C19.9205 18.8576 20.5 17.4587 20.5 16C20.5 14.5413 19.9205 13.1424 18.8891 12.1109C18.6781 11.9 18.4518 11.7079 18.2128 11.5359C19.041 10.5492 19.5 9.29829 19.5 8C19.5 6.54131 18.9205 5.14236 17.8891 4.11091C16.8576 3.07946 15.4587 2.5 14 2.5H6ZM14 10.5C14.663 10.5 15.2989 10.2366 15.7678 9.76777C16.2366 9.29893 16.5 8.66304 16.5 8C16.5 7.33696 16.2366 6.70107 15.7678 6.23223C15.2989 5.76339 14.663 5.5 14 5.5H7.5V10.5H14ZM7.5 18.5V13.5H15C15.663 13.5 16.2989 13.7634 16.7678 14.2322C17.2366 14.7011 17.5 15.337 17.5 16C17.5 16.663 17.2366 17.2989 16.7678 17.7678C16.2989 18.2366 15.663 18.5 15 18.5H7.5Z"/></svg>`
const I_ITALIC = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.0222 3H19C19.5523 3 20 3.44772 20 4C20 4.55228 19.5523 5 19 5H15.693L10.443 19H14C14.5523 19 15 19.4477 15 20C15 20.5523 14.5523 21 14 21H9.02418C9.00802 21.0004 8.99181 21.0004 8.97557 21H5C4.44772 21 4 20.5523 4 20C4 19.4477 4.44772 19 5 19H8.30704L13.557 5H10C9.44772 5 9 4.55228 9 4C9 3.44772 9.44772 3 10 3H14.9782C14.9928 2.99968 15.0075 2.99967 15.0222 3Z"/></svg>`
const I_STRIKE = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.00039 3H16.0001C16.5524 3 17.0001 3.44772 17.0001 4C17.0001 4.55229 16.5524 5 16.0001 5H9.00011C8.68006 4.99983 8.36412 5.07648 8.07983 5.22349C7.79555 5.37051 7.55069 5.5836 7.36585 5.84487C7.181 6.10614 7.06155 6.40796 7.01754 6.72497C6.97352 7.04198 7.00623 7.36492 7.11292 7.66667C7.29701 8.18737 7.02414 8.75872 6.50344 8.94281C5.98274 9.1269 5.4114 8.85403 5.2273 8.33333C5.01393 7.72984 4.94851 7.08396 5.03654 6.44994C5.12456 5.81592 5.36346 5.21229 5.73316 4.68974C6.10285 4.1672 6.59256 3.74101 7.16113 3.44698C7.72955 3.15303 8.36047 2.99975 9.00039 3Z"/><path d="M18 13H20C20.5523 13 21 12.5523 21 12C21 11.4477 20.5523 11 20 11H4C3.44772 11 3 11.4477 3 12C3 12.5523 3.44772 13 4 13H14C14.7956 13 15.5587 13.3161 16.1213 13.8787C16.6839 14.4413 17 15.2044 17 16C17 16.7956 16.6839 17.5587 16.1213 18.1213C15.5587 18.6839 14.7956 19 14 19H6C5.44772 19 5 19.4477 5 20C5 20.5523 5.44772 21 6 21H14C15.3261 21 16.5979 20.4732 17.5355 19.5355C18.4732 18.5979 19 17.3261 19 16C19 14.9119 18.6453 13.8604 18 13Z"/></svg>`
const I_CODE = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M8.7 7.3a1 1 0 0 0-1.4 0l-4 4a1 1 0 0 0 0 1.4l4 4a1 1 0 0 0 1.4-1.4L5.4 12l3.3-3.3a1 1 0 0 0 0-1.4Zm6.6 0a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 0 1-1.4-1.4L18.6 12l-3.3-3.3a1 1 0 0 1 0-1.4Z"/></svg>`
const I_BULLET = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm0 5a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm0 5a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm5-9.5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H9a1 1 0 0 1-1-1Zm0 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H9a1 1 0 0 1-1-1Zm0 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H9a1 1 0 0 1-1-1Z"/></svg>`
const I_QUOTE = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 7H5a1 1 0 0 0-1 1v4a4 4 0 0 0 4 4 1 1 0 1 0 0-2 2 2 0 0 1-2-2h2a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Zm10 0h-4a1 1 0 0 0-1 1v4a4 4 0 0 0 4 4 1 1 0 0 0 0-2 2 2 0 0 1-2-2h2a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Z"/></svg>`
const I_CODEBLOCK = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H4Zm0 2h16v10H4V7Zm4.7 1.3a1 1 0 0 0-1.4 1.4L9.6 12l-2.3 2.3a1 1 0 1 0 1.4 1.4l3-3a1 1 0 0 0 0-1.4l-3-3ZM13 14a1 1 0 1 0 0 2h4a1 1 0 1 0 0-2h-4Z"/></svg>`
const I_HR = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 12a1 1 0 0 1 1-1h16a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Z"/></svg>`
const I_LINK = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.41 13.59a1 1 0 0 0 0 1.41 4 4 0 0 1-5.66 0 4 4 0 0 1 0-5.65L7.59 6.5a4 4 0 0 1 5.66 0 1 1 0 0 0 1.41-1.41 6 6 0 0 0-8.48 0L3.34 7.93a6 6 0 0 0 0 8.48 6 6 0 0 0 8.48 0 1 1 0 0 0 0-1.41 1 1 0 0 0-1.41 0Zm10.25-9.25a6 6 0 0 0-8.48 0 1 1 0 1 0 1.41 1.41 4 4 0 0 1 5.66 0 4 4 0 0 1 0 5.66l-2.83 2.83a4 4 0 0 1-5.66 0 1 1 0 0 0-1.41 1.41 6 6 0 0 0 8.48 0l2.83-2.82a6 6 0 0 0 0-8.48Z"/></svg>`
const I_IMAGE = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM5 5h14v8.59l-2.29-2.3a1 1 0 0 0-1.42 0L11 15.59l-1.79-1.8a1 1 0 0 0-1.42 0L5 16.59V5Zm0 14v-1.41l4-4 4.59 4.59A1 1 0 0 0 14 18l2-2 3 3v.41H5Zm10-9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>`
const I_UNDO = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.70711 3.70711C10.0976 3.31658 10.0976 2.68342 9.70711 2.29289C9.31658 1.90237 8.68342 1.90237 8.29289 2.29289L3.29289 7.29289C2.90237 7.68342 2.90237 8.31658 3.29289 8.70711L8.29289 13.7071C8.68342 14.0976 9.31658 14.0976 9.70711 13.7071C10.0976 13.3166 10.0976 12.6834 9.70711 12.2929L6.41421 9H14.5C15.0909 9 15.6761 9.1164 16.2221 9.34254C16.768 9.56869 17.2641 9.90016 17.682 10.318C18.0998 10.7359 18.4313 11.232 18.6575 11.7779C18.8836 12.3239 19 12.9091 19 13.5C19 14.0909 18.8836 14.6761 18.6575 15.2221C18.4313 15.768 18.0998 16.2641 17.682 16.682C17.2641 17.0998 16.768 17.4313 16.2221 17.6575C15.6761 17.8836 15.0909 18 14.5 18H11C10.4477 18 10 18.4477 10 19C10 19.5523 10.4477 20 11 20H14.5C15.3536 20 16.1988 19.8319 16.9874 19.5052C17.7761 19.1786 18.4926 18.6998 19.0962 18.0962C19.6998 17.4926 20.1786 16.7761 20.5052 15.9874C20.8319 15.1988 21 14.3536 21 13.5C21 12.6464 20.8319 11.8012 20.5052 11.0126C20.1786 10.2239 19.6998 9.50739 19.0962 8.90381C18.4926 8.30022 17.7761 7.82144 16.9874 7.49478C16.1988 7.16813 15.3536 7 14.5 7H6.41421L9.70711 3.70711Z"/></svg>`
const I_REDO = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M15.7071 2.29289C15.3166 1.90237 14.6834 1.90237 14.2929 2.29289C13.9024 2.68342 13.9024 3.31658 14.2929 3.70711L17.5858 7H9.5C7.77609 7 6.12279 7.68482 4.90381 8.90381C3.68482 10.1228 3 11.7761 3 13.5C3 14.3536 3.16813 15.1988 3.49478 15.9874C3.82144 16.7761 4.30023 17.4926 4.90381 18.0962C6.12279 19.3152 7.77609 20 9.5 20H13C13.5523 20 14 19.5523 14 19C14 18.4477 13.5523 18 13 18H9.5C8.30653 18 7.16193 17.5259 6.31802 16.682C5.90016 16.2641 5.56869 15.768 5.34254 15.2221C5.1164 14.6761 5 14.0909 5 13.5C5 12.3065 5.47411 11.1619 6.31802 10.318C7.16193 9.47411 8.30653 9 9.5 9H17.5858L14.2929 12.2929C13.9024 12.6834 13.9024 13.3166 14.2929 13.7071C14.6834 14.0976 15.3166 14.0976 15.7071 13.7071L20.7071 8.70711C21.0976 8.31658 21.0976 7.68342 20.7071 7.29289L15.7071 2.29289Z"/></svg>`
const I_SOURCE = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.97 3l1.95.42-3.95 18-1.95-.42 3.95-18ZM6.7 6.3a1 1 0 0 1 1.4 1.4L4.4 11.5l3.7 3.8a1 1 0 1 1-1.4 1.4l-4.4-4.4a1 1 0 0 1 0-1.42l4.4-4.4Zm10.6 0a1 1 0 0 0-1.4 1.4l3.7 3.8-3.7 3.8a1 1 0 1 0 1.4 1.4l4.4-4.4a1 1 0 0 0 0-1.42l-4.4-4.4Z"/></svg>`
const I_TASK = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M10 6a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H11a1 1 0 0 1-1-1Zm0 6a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H11a1 1 0 0 1-1-1Zm0 6a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H11a1 1 0 0 1-1-1ZM7.7 4.3a1 1 0 0 1 0 1.4l-3 3a1 1 0 0 1-1.4 0l-1.5-1.5a1 1 0 1 1 1.4-1.4l.8.79 2.3-2.3a1 1 0 0 1 1.4 0Zm0 6a1 1 0 0 1 0 1.4l-3 3a1 1 0 0 1-1.4 0l-1.5-1.5a1 1 0 1 1 1.4-1.4l.8.79 2.3-2.3a1 1 0 0 1 1.4 0Zm0 6a1 1 0 0 1 0 1.4l-3 3a1 1 0 0 1-1.4 0l-1.5-1.5a1 1 0 1 1 1.4-1.4l.8.79 2.3-2.3a1 1 0 0 1 1.4 0Z"/></svg>`
const I_CHEVRON = `<svg class="tb-chevron" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.3 8.3a1 1 0 0 1 1.4 0l5.3 5.3 5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4Z"/></svg>`

interface ButtonDef {
  command: string
  content: string
  isText?: boolean
  label: string
  isActive?: (editor: Editor) => boolean
  formatting?: boolean
}

interface DropdownItem {
  label: string
  command: string
  isActive?: (editor: Editor) => boolean
}

interface DropdownDef {
  ariaLabel: string
  /** Inner HTML of the trigger; for headings it reflects the active level. */
  triggerContent: (editor: Editor | null) => string
  items: DropdownItem[]
  formatting: boolean
}

type Entry = { kind: 'button'; def: ButtonDef } | { kind: 'dropdown'; def: DropdownDef }

function headingLabel(editor: Editor | null): string {
  if (editor) {
    for (const lvl of [1, 2, 3]) {
      if (editor.isActive('heading', { level: lvl })) return `H${lvl}`
    }
  }
  return '¶'
}

const GROUPS: Entry[][] = [
  [
    { kind: 'button', def: { command: 'edit.undo', content: I_UNDO, label: 'Undo (⌘Z)' } },
    { kind: 'button', def: { command: 'edit.redo', content: I_REDO, label: 'Redo (⌘⇧Z)' } },
  ],
  [
    {
      kind: 'dropdown',
      def: {
        ariaLabel: 'Text style',
        triggerContent: (e) => `<span class="tb-dd-label">${headingLabel(e)}</span>${I_CHEVRON}`,
        formatting: true,
        items: [
          { label: 'Paragraph', command: 'format.paragraph', isActive: (e) => e.isActive('paragraph') },
          { label: 'Heading 1', command: 'format.heading1', isActive: (e) => e.isActive('heading', { level: 1 }) },
          { label: 'Heading 2', command: 'format.heading2', isActive: (e) => e.isActive('heading', { level: 2 }) },
          { label: 'Heading 3', command: 'format.heading3', isActive: (e) => e.isActive('heading', { level: 3 }) },
        ],
      },
    },
  ],
  [
    { kind: 'button', def: { command: 'format.bold', content: I_BOLD, label: 'Bold (⌘B)', isActive: (e) => e.isActive('bold'), formatting: true } },
    { kind: 'button', def: { command: 'format.italic', content: I_ITALIC, label: 'Italic (⌘I)', isActive: (e) => e.isActive('italic'), formatting: true } },
    { kind: 'button', def: { command: 'format.strike', content: I_STRIKE, label: 'Strikethrough', isActive: (e) => e.isActive('strike'), formatting: true } },
    { kind: 'button', def: { command: 'format.code', content: I_CODE, label: 'Inline code (⌘E)', isActive: (e) => e.isActive('code'), formatting: true } },
  ],
  [
    {
      kind: 'dropdown',
      def: {
        ariaLabel: 'List',
        triggerContent: () => `${I_BULLET}${I_CHEVRON}`,
        formatting: true,
        items: [
          { label: 'Bullet List', command: 'format.bulletList', isActive: (e) => e.isActive('bulletList') },
          { label: 'Ordered List', command: 'format.orderedList', isActive: (e) => e.isActive('orderedList') },
          { label: 'Task List', command: 'format.taskList', isActive: (e) => e.isActive('taskList') },
        ],
      },
    },
  ],
  [
    { kind: 'button', def: { command: 'format.blockquote', content: I_QUOTE, label: 'Blockquote', isActive: (e) => e.isActive('blockquote'), formatting: true } },
    { kind: 'button', def: { command: 'format.codeBlock', content: I_CODEBLOCK, label: 'Code block', isActive: (e) => e.isActive('codeBlock'), formatting: true } },
    { kind: 'button', def: { command: 'format.horizontalRule', content: I_HR, label: 'Horizontal rule', formatting: true } },
  ],
  [
    { kind: 'button', def: { command: 'insert.link', content: I_LINK, label: 'Insert link (⌘K)', formatting: true } },
    { kind: 'button', def: { command: 'insert.image', content: I_IMAGE, label: 'Insert image', formatting: true } },
  ],
  [{ kind: 'button', def: { command: 'view.toggleSource', content: I_SOURCE, label: 'Toggle source view (⌘/)' } }],
]

// Item icons for the list dropdown menu rows (heading rows are text-only).
const LIST_ITEM_ICONS: Record<string, string> = {
  'format.bulletList': I_BULLET,
  'format.orderedList': `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5h.5V8h-.5a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1h-.5V4.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0 0 1Zm5 .5a1 1 0 0 1 1-1h11a1 1 0 1 1 0 2H10a1 1 0 0 1-1-1Zm0 6a1 1 0 0 1 1-1h11a1 1 0 1 1 0 2H10a1 1 0 0 1-1-1Zm0 6a1 1 0 0 1 1-1h11a1 1 0 1 1 0 2H10a1 1 0 0 1-1-1ZM4.75 12.7c.27-.06.55.07.66.32.1.24.04.51-.15.69l-1.6 1.55a.5.5 0 0 0 .34.85h2a.5.5 0 0 0 0-1H4.6l.99-.96a1.5 1.5 0 0 0-2.36-1.86.5.5 0 1 0 .78.63c.15-.19.39-.27.61-.22Z"/></svg>`,
  'format.taskList': I_TASK,
}

export function mountToolbar(tm: TabManager): { refresh: () => void } {
  const root = document.getElementById('toolbar')
  if (!root) return { refresh: (): void => {} }
  root.replaceChildren()

  const buttonRecords: { el: HTMLButtonElement; def: ButtonDef }[] = []
  const dropdownRecords: { trigger: HTMLButtonElement; def: DropdownDef }[] = []

  // --- Single open-menu manager (only one dropdown open at a time) ---
  let openMenu: HTMLElement | null = null
  let openTrigger: HTMLButtonElement | null = null

  function closeMenu(): void {
    openMenu?.remove()
    openMenu = null
    if (openTrigger) {
      openTrigger.classList.remove('is-open')
      openTrigger.setAttribute('aria-expanded', 'false')
      openTrigger = null
    }
  }

  function openMenuFor(trigger: HTMLButtonElement, def: DropdownDef): void {
    closeMenu()
    const tab = tm.active()
    const editor = tab?.editor ?? null
    const menu = document.createElement('div')
    menu.className = 'tb-menu'
    menu.setAttribute('role', 'menu')

    for (const item of def.items) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'tb-menu-item'
      row.setAttribute('role', 'menuitemradio')
      const active = !!editor && !!item.isActive?.(editor)
      row.classList.toggle('is-active', active)
      row.setAttribute('aria-checked', String(active))
      const icon = LIST_ITEM_ICONS[item.command]
      row.innerHTML = `${icon ? `<span class="tb-menu-icon">${icon}</span>` : ''}<span class="tb-menu-label">${item.label}</span>`
      row.addEventListener('click', () => {
        closeMenu()
        const t = tm.active()
        if (!t) return
        if (def.formatting && t.viewController?.mode === 'source') return
        commands.execute(item.command)
      })
      menu.appendChild(row)
    }

    document.body.appendChild(menu)
    const r = trigger.getBoundingClientRect()
    menu.style.top = `${r.bottom + 4}px`
    menu.style.left = `${r.left}px`
    openMenu = menu
    openTrigger = trigger
    trigger.classList.add('is-open')
    trigger.setAttribute('aria-expanded', 'true')
  }

  function makeSep(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'tb-sep'
    el.setAttribute('role', 'separator')
    el.setAttribute('aria-orientation', 'vertical')
    return el
  }

  GROUPS.forEach((group, gi) => {
    if (gi > 0) root.appendChild(makeSep())
    for (const entry of group) {
      if (entry.kind === 'button') {
        const def = entry.def
        const el = document.createElement('button')
        el.type = 'button'
        el.className = def.isText ? 'tb tb-text' : 'tb'
        el.title = def.label
        el.setAttribute('aria-label', def.label)
        if (def.isText) el.textContent = def.content
        else el.innerHTML = def.content
        el.addEventListener('click', () => {
          const tab = tm.active()
          if (!tab) return
          if (def.formatting && tab.viewController?.mode === 'source') return
          commands.execute(def.command)
        })
        root.appendChild(el)
        buttonRecords.push({ el, def })
      } else {
        const def = entry.def
        const trigger = document.createElement('button')
        trigger.type = 'button'
        trigger.className = 'tb tb-dropdown'
        trigger.title = def.ariaLabel
        trigger.setAttribute('aria-label', def.ariaLabel)
        trigger.setAttribute('aria-haspopup', 'menu')
        trigger.setAttribute('aria-expanded', 'false')
        trigger.innerHTML = def.triggerContent(null)
        trigger.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (openTrigger === trigger) closeMenu()
          else openMenuFor(trigger, def)
        })
        root.appendChild(trigger)
        dropdownRecords.push({ trigger, def })
      }
    }
  })

  // Global dismissal for the dropdown menus.
  const onDocMouseDown = (e: MouseEvent): void => {
    if (!openMenu) return
    const t = e.target as Node | null
    if (t && (openMenu.contains(t) || openTrigger?.contains(t))) return
    closeMenu()
  }
  const onDocKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && openMenu) {
      e.preventDefault()
      closeMenu()
    }
  }
  document.addEventListener('mousedown', onDocMouseDown)
  document.addEventListener('keydown', onDocKeyDown)

  const refresh = (): void => {
    const tab = tm.active()
    const isSource = tab?.viewController?.mode === 'source'
    const editor = tab?.editor ?? null

    for (const { el, def } of buttonRecords) {
      if (def.formatting) el.classList.toggle('is-disabled', !tab || isSource)
      if (def.isActive) {
        el.classList.toggle('is-active', !!tab && !isSource && def.isActive(tab.editor))
      } else if (def.command === 'view.toggleSource') {
        el.classList.toggle('is-active', !!isSource)
      }
    }

    for (const { trigger, def } of dropdownRecords) {
      if (def.formatting) trigger.classList.toggle('is-disabled', !tab || isSource)
      // Refresh trigger content (heading level reflects active block).
      trigger.innerHTML = def.triggerContent(isSource ? null : editor)
      // Mark the trigger active if any of its items is active.
      const anyActive =
        !!editor && !isSource && def.items.some((i) => i.isActive?.(editor))
      trigger.classList.toggle('is-active', anyActive)
    }
  }

  return { refresh }
}
