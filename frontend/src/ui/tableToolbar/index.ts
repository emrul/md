import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import './table-toolbar.css'

interface TableLocation {
  node: PMNode
  pos: number
}

function findTable(state: EditorState): TableLocation | null {
  const $from = state.selection.$from
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table') {
      return { node, pos: $from.before(d) }
    }
  }
  return null
}

interface ButtonSpec {
  label: string
  title: string
  action: (editor: Editor) => void
  danger?: boolean
}

const BUTTONS: ButtonSpec[] = [
  {
    label: '+Row ↑',
    title: 'Insert row above',
    action: (e) => e.chain().focus().addRowBefore().run(),
  },
  {
    label: '+Row ↓',
    title: 'Insert row below',
    action: (e) => e.chain().focus().addRowAfter().run(),
  },
  {
    label: '+Col ←',
    title: 'Insert column before',
    action: (e) => e.chain().focus().addColumnBefore().run(),
  },
  {
    label: '+Col →',
    title: 'Insert column after',
    action: (e) => e.chain().focus().addColumnAfter().run(),
  },
  {
    label: 'Header',
    title: 'Toggle header row',
    action: (e) => e.chain().focus().toggleHeaderRow().run(),
  },
  {
    label: '−Row',
    title: 'Delete row',
    action: (e) => e.chain().focus().deleteRow().run(),
    danger: true,
  },
  {
    label: '−Col',
    title: 'Delete column',
    action: (e) => e.chain().focus().deleteColumn().run(),
    danger: true,
  },
  {
    label: '−Table',
    title: 'Delete table',
    action: (e) => e.chain().focus().deleteTable().run(),
    danger: true,
  },
]

export function mountTableToolbar(editor: Editor): { destroy: () => void } {
  const root = document.createElement('div')
  root.className = 'table-toolbar'
  document.body.appendChild(root)

  BUTTONS.forEach((b, i) => {
    if (i === 5) {
      const sep = document.createElement('span')
      sep.className = 'tt-sep'
      root.appendChild(sep)
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tt-btn' + (b.danger ? ' tt-danger' : '')
    btn.textContent = b.label
    btn.title = b.title
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      b.action(editor)
    })
    root.appendChild(btn)
  })

  let currentTable: TableLocation | null = null
  let positionRaf: number | null = null

  const position = (): void => {
    if (!currentTable) {
      root.classList.remove('is-visible')
      return
    }
    const dom = editor.view.nodeDOM(currentTable.pos) as HTMLElement | null
    if (!dom) {
      root.classList.remove('is-visible')
      return
    }
    const rect = dom.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      root.classList.remove('is-visible')
      return
    }
    root.classList.add('is-visible')
    const top = Math.max(8, rect.top - root.offsetHeight - 6)
    root.style.top = `${top}px`
    root.style.left = `${Math.max(8, rect.left)}px`
  }

  const schedulePosition = (): void => {
    if (positionRaf !== null) cancelAnimationFrame(positionRaf)
    positionRaf = requestAnimationFrame(() => {
      positionRaf = null
      position()
    })
  }

  const refresh = (): void => {
    const next = findTable(editor.state)
    if (!next) {
      currentTable = null
      root.classList.remove('is-visible')
      return
    }
    currentTable = next
    schedulePosition()
  }

  editor.on('selectionUpdate', refresh)
  editor.on('update', refresh)
  editor.on('focus', refresh)
  editor.on('blur', () => {
    if (!root.matches(':hover')) root.classList.remove('is-visible')
  })

  const onScroll = (): void => schedulePosition()
  const onResize = (): void => schedulePosition()
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)

  refresh()

  return {
    destroy() {
      editor.off('selectionUpdate', refresh)
      editor.off('update', refresh)
      editor.off('focus', refresh)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      if (positionRaf !== null) cancelAnimationFrame(positionRaf)
      root.remove()
    },
  }
}
