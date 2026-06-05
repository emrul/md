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

const COPY_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>'
const CHECK_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>'

export function mountCodeBlockLangPicker(editor: Editor): LangPickerHandle {
  const root = document.createElement('div')
  root.className = 'cb-lang-picker'
  document.body.appendChild(root)

  // Copy + language sit in one bar so the copy button lands to the left of the
  // language dropdown.
  const bar = document.createElement('div')
  bar.className = 'cb-lang-bar'
  root.appendChild(bar)

  const copyBtn = document.createElement('button')
  copyBtn.type = 'button'
  copyBtn.className = 'cb-copy-btn'
  copyBtn.innerHTML = COPY_ICON
  copyBtn.title = 'Copy code'
  copyBtn.setAttribute('aria-label', 'Copy code')
  bar.appendChild(copyBtn)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'cb-lang-btn'
  button.textContent = 'Plain Text'
  button.title = 'Change language'
  bar.appendChild(button)

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

  // `currentBlock` is the block the picker currently targets — derived from the
  // selection (caret in a block) and the pointer (hovering a block), so the
  // copy/language controls also surface on hover, not only on focus.
  let currentBlock: CodeBlockLocation | null = null
  let selBlock: CodeBlockLocation | null = null
  let hoverBlock: CodeBlockLocation | null = null
  let pickerHovered = false
  let open = false
  let filterText = ''
  let selectedIndex = 0
  let filtered: LanguageOption[] = LANGUAGE_OPTIONS
  let positionRaf: number | null = null
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null
  let scrollRegion: HTMLElement | null = null

  // Nearest scrollable ancestor of the editor — its top edge is where the app
  // chrome (toolbar/tab strip) ends, so the picker must never ride above it.
  const findScrollRegion = (): HTMLElement | null => {
    if (scrollRegion && scrollRegion.isConnected) return scrollRegion
    let p: HTMLElement | null = editor.view.dom.parentElement
    while (p) {
      const oy = getComputedStyle(p).overflowY
      if (oy === 'auto' || oy === 'scroll') break
      p = p.parentElement
    }
    scrollRegion = p
    return p
  }

  const writeClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for environments without async clipboard access.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* give up silently */
      }
      ta.remove()
    }
  }

  const flashCopied = (): void => {
    copyBtn.innerHTML = CHECK_ICON
    copyBtn.classList.add('is-copied')
    copyBtn.title = 'Copied'
    if (copyResetTimer) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => {
      copyBtn.innerHTML = COPY_ICON
      copyBtn.classList.remove('is-copied')
      copyBtn.title = 'Copy code'
      copyResetTimer = null
    }, 1200)
  }

  // Don't let the button steal the editor selection or trip the outside-click
  // dropdown close.
  copyBtn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  copyBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!currentBlock) return
    void writeClipboard(currentBlock.node.textContent)
    flashCopied()
  })

  // Resolve the code block (if any) the given DOM node sits in — used to surface
  // the picker on hover. Covers the plain `<pre>` node view and the mermaid
  // wrapper (whose `<pre>` is hidden behind the rendered diagram).
  const codeBlockAt = (target: EventTarget | null): CodeBlockLocation | null => {
    if (!(target instanceof HTMLElement)) return null
    const el = target.closest('pre, .mermaid-block')
    if (!el || !editor.view.dom.contains(el)) return null
    const codeEl = el.querySelector('code')
    if (!codeEl) return null
    let pos: number
    try {
      pos = editor.view.posAtDOM(codeEl, 0)
    } catch {
      return null
    }
    const $pos = editor.state.doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d)
      if (node.type.name === 'codeBlock') return { node, pos: $pos.before(d) }
    }
    return null
  }

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
    const region = findScrollRegion()
    const rr = region ? region.getBoundingClientRect() : null
    const regionTop = rr ? rr.top : 0
    const regionBottom = rr ? rr.bottom : window.innerHeight
    // Hide once the code block has scrolled out of the visible content region,
    // and clamp the picker to that region's top so it never paints over chrome.
    if (rect.bottom <= regionTop || rect.top >= regionBottom) {
      root.style.display = 'none'
      return
    }
    root.style.display = 'block'
    root.style.top = `${Math.max(regionTop + 8, rect.top + 8)}px`
    root.style.left = `${Math.max(8, rect.right - root.offsetWidth - 8)}px`
  }

  const schedulePosition = (): void => {
    if (positionRaf !== null) cancelAnimationFrame(positionRaf)
    positionRaf = requestAnimationFrame(() => {
      positionRaf = null
      position()
    })
  }

  // Pick the block to show the picker for. While the dropdown is open or the
  // pointer rests on the picker itself, hold the current target steady so the
  // control doesn't slide out from under the user; otherwise a hovered block
  // wins over the caret's block.
  const updateTarget = (): void => {
    const next = open || pickerHovered ? currentBlock : (hoverBlock ?? selBlock)
    if (!next) {
      currentBlock = null
      if (!open) {
        root.style.display = 'none'
      }
      return
    }
    currentBlock = next
    const lang = (next.node.attrs.language as string | null | undefined) ?? ''
    button.textContent = languageLabel(lang)
    schedulePosition()
  }

  const refresh = (): void => {
    selBlock = findCodeBlock(editor.state)
    updateTarget()
  }

  editor.on('selectionUpdate', refresh)
  editor.on('update', refresh)
  editor.on('focus', refresh)
  editor.on('blur', () => {
    selBlock = null
    updateTarget()
  })

  // Highlighted code is a thicket of spans, so mouseover fires constantly while
  // the pointer stays inside one block. Track the hovered block element and skip
  // the pos resolve + reposition when it hasn't changed.
  let hoverEl: Element | null = null
  const hoverElementOf = (target: EventTarget | null): Element | null =>
    target instanceof HTMLElement ? target.closest('pre, .mermaid-block') : null

  const onPointerOver = (e: MouseEvent): void => {
    const el = hoverElementOf(e.target)
    if (el === hoverEl) return
    hoverEl = el
    hoverBlock = codeBlockAt(e.target)
    updateTarget()
  }
  const onPointerOut = (e: MouseEvent): void => {
    const related = e.relatedTarget
    // Moving onto the picker is not a leave — keep the current target.
    if (related instanceof Node && root.contains(related)) return
    const el = hoverElementOf(related)
    if (el === hoverEl) return
    hoverEl = el
    hoverBlock = codeBlockAt(related)
    updateTarget()
  }
  editor.view.dom.addEventListener('mouseover', onPointerOver)
  editor.view.dom.addEventListener('mouseout', onPointerOut)

  root.addEventListener('mouseenter', () => {
    pickerHovered = true
  })
  root.addEventListener('mouseleave', (e) => {
    pickerHovered = false
    hoverEl = hoverElementOf(e.relatedTarget)
    hoverBlock = codeBlockAt(e.relatedTarget)
    updateTarget()
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
      editor.view.dom.removeEventListener('mouseover', onPointerOver)
      editor.view.dom.removeEventListener('mouseout', onPointerOut)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('mousedown', onDocumentMouseDown, true)
      if (positionRaf !== null) cancelAnimationFrame(positionRaf)
      if (copyResetTimer !== null) clearTimeout(copyResetTimer)
      root.remove()
    },
  }
}
