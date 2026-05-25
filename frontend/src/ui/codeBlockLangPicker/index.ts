import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  LANGUAGE_OPTIONS,
  languageLabel,
  type LanguageOption,
} from '../../editor/extensions/lowlight'
import './lang-picker.css'

interface CodeBlockLocation {
  node: PMNode
  pos: number
}

function findCodeBlock(state: EditorState): CodeBlockLocation | null {
  const $from = state.selection.$from
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'codeBlock') {
      return { node, pos: $from.before(d) }
    }
  }
  return null
}

export interface LangPickerHandle {
  destroy: () => void
}

export function mountCodeBlockLangPicker(editor: Editor): LangPickerHandle {
  const root = document.createElement('div')
  root.className = 'cb-lang-picker'
  document.body.appendChild(root)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'cb-lang-btn'
  button.textContent = 'Plain Text'
  button.title = 'Change language'
  root.appendChild(button)

  const dropdown = document.createElement('div')
  dropdown.className = 'cb-lang-dropdown'
  dropdown.style.display = 'none'

  const filterWrap = document.createElement('div')
  filterWrap.className = 'cb-lang-filter'
  const filterInput = document.createElement('input')
  filterInput.type = 'text'
  filterInput.placeholder = 'Search…'
  filterInput.spellcheck = false
  filterInput.setAttribute('aria-label', 'Search languages')
  filterWrap.appendChild(filterInput)

  const list = document.createElement('div')
  list.className = 'cb-lang-list'

  dropdown.append(filterWrap, list)
  root.appendChild(dropdown)

  let currentBlock: CodeBlockLocation | null = null
  let open = false
  let filterText = ''
  let selectedIndex = 0
  let filtered: LanguageOption[] = LANGUAGE_OPTIONS
  let positionRaf: number | null = null

  const setLanguage = (lang: string): void => {
    if (!currentBlock) return
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        if (!currentBlock) return false
        if (dispatch) {
          tr.setNodeAttribute(currentBlock.pos, 'language', lang || null)
        }
        return true
      })
      .run()
    closeDropdown()
  }

  const renderList = (): void => {
    list.replaceChildren()
    const currentLang = (currentBlock?.node.attrs.language as string | null | undefined) ?? ''
    if (filtered.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'cb-lang-empty'
      empty.textContent = 'No matches'
      list.appendChild(empty)
      return
    }
    filtered.forEach((opt, i) => {
      const row = document.createElement('div')
      const isSelected = i === selectedIndex
      const isActive = opt.id === currentLang
      row.className =
        'cb-lang-item' + (isSelected ? ' is-selected' : '') + (isActive ? ' is-active' : '')

      const label = document.createElement('span')
      label.textContent = opt.label
      row.appendChild(label)

      if (opt.id) {
        const id = document.createElement('span')
        id.style.opacity = '0.55'
        id.style.fontFamily = "'SF Mono', 'Fira Mono', Menlo, Consolas, monospace"
        id.style.fontSize = '11px'
        id.textContent = opt.id
        row.appendChild(id)
      }

      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        setLanguage(opt.id)
      })
      row.addEventListener('mouseenter', () => {
        if (selectedIndex !== i) {
          selectedIndex = i
          renderList()
        }
      })
      list.appendChild(row)
    })
  }

  const applyFilter = (): void => {
    const q = filterText.trim().toLowerCase()
    filtered = q
      ? LANGUAGE_OPTIONS.filter((o) => o.search.includes(q) || o.label.toLowerCase().includes(q))
      : LANGUAGE_OPTIONS
    if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1)
    renderList()
  }

  const openDropdown = (): void => {
    if (open) return
    open = true
    filterText = ''
    filterInput.value = ''
    selectedIndex = Math.max(
      0,
      LANGUAGE_OPTIONS.findIndex(
        (o) => o.id === ((currentBlock?.node.attrs.language as string | null | undefined) ?? ''),
      ),
    )
    applyFilter()
    dropdown.style.display = 'flex'
    button.classList.add('is-open')
    requestAnimationFrame(() => filterInput.focus())
  }

  const closeDropdown = (): void => {
    if (!open) return
    open = false
    dropdown.style.display = 'none'
    button.classList.remove('is-open')
  }

  button.addEventListener('mousedown', (e) => {
    e.preventDefault()
    if (open) closeDropdown()
    else openDropdown()
  })

  filterInput.addEventListener('input', () => {
    filterText = filterInput.value
    selectedIndex = 0
    applyFilter()
  })

  filterInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length === 0) return
      selectedIndex = (selectedIndex + 1) % filtered.length
      renderList()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length === 0) return
      selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length
      renderList()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[selectedIndex]
      if (opt) setLanguage(opt.id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeDropdown()
      editor.commands.focus()
    }
  })

  const onDocumentMouseDown = (e: MouseEvent): void => {
    if (!open) return
    if (root.contains(e.target as Node)) return
    closeDropdown()
  }
  document.addEventListener('mousedown', onDocumentMouseDown, true)

  const position = (): void => {
    if (!currentBlock) {
      root.style.display = 'none'
      return
    }
    const dom = editor.view.nodeDOM(currentBlock.pos) as HTMLElement | null
    if (!dom) {
      root.style.display = 'none'
      return
    }
    const rect = dom.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      root.style.display = 'none'
      return
    }
    root.style.display = 'block'
    root.style.top = `${Math.max(8, rect.top + 8)}px`
    root.style.left = `${Math.max(8, rect.right - root.offsetWidth - 8)}px`
  }

  const schedulePosition = (): void => {
    if (positionRaf !== null) cancelAnimationFrame(positionRaf)
    positionRaf = requestAnimationFrame(() => {
      positionRaf = null
      position()
    })
  }

  const refresh = (): void => {
    const next = findCodeBlock(editor.state)
    if (!next) {
      currentBlock = null
      closeDropdown()
      root.style.display = 'none'
      return
    }
    currentBlock = next
    const lang = (next.node.attrs.language as string | null | undefined) ?? ''
    button.textContent = languageLabel(lang)
    schedulePosition()
  }

  editor.on('selectionUpdate', refresh)
  editor.on('update', refresh)
  editor.on('focus', refresh)
  editor.on('blur', () => {
    if (!open) root.style.display = 'none'
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
      document.removeEventListener('mousedown', onDocumentMouseDown, true)
      if (positionRaf !== null) cancelAnimationFrame(positionRaf)
      root.remove()
    },
  }
}
