import './toc.css'
import type { TabManager } from '../../app/tabManager'
import type { ExplorerState } from '../../app/explorerState'
import type { Tab } from '../../app/tab'

// Bulleted-list glyph, matching the line-icon style used elsewhere in the app.
const LIST_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h7"/><path d="M6 8h7"/><path d="M6 12h7"/><circle cx="3" cy="4" r="0.9" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="0.9" fill="currentColor" stroke="none"/></svg>`

// Show the affordance only once a doc is worth navigating: it must overflow
// the viewport AND carry more than a couple of headings. Tunable.
const MIN_HEADINGS = 3
// A heading counts as the "current section" once its top is within this many
// px of the scroll container top (accounts for the editor's top padding).
const ACTIVATION_OFFSET = 80
// Button footprint + gap from the content's left edge (keep in sync with the
// .toc-button size in toc.css).
const BUTTON_SIZE = 32
const BUTTON_GAP = 10

interface HeadingEntry {
  el: HTMLElement
  level: number
  text: string
}

export function mountToc(
  tm: TabManager,
  explorer: ExplorerState,
  host: HTMLElement,
): { refresh: () => void } {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'toc-button'
  button.title = 'Table of contents'
  button.setAttribute('aria-label', 'Table of contents')
  button.setAttribute('aria-haspopup', 'true')
  button.setAttribute('aria-expanded', 'false')
  button.innerHTML = LIST_ICON

  const panel = document.createElement('nav')
  panel.className = 'toc-panel'
  panel.setAttribute('aria-label', 'Document outline')

  host.append(button, panel)

  let panelOpen = false
  let entries: HeadingEntry[] = []
  let activeIndex = -1
  let boundScrollEl: HTMLElement | null = null
  let rafPending = false

  const isSourceMode = (tab: Tab): boolean =>
    tab.viewController?.mode === 'source'

  function collectHeadings(tab: Tab): HeadingEntry[] {
    const nodes = tab.dom.editorElement.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6',
    )
    const list: HeadingEntry[] = []
    nodes.forEach((el) => {
      list.push({ el, level: Number(el.tagName.slice(1)), text: headingText(el) })
    })
    return list
  }

  // The hybrid live-preview injects markdown markers ("# ", "**", etc.) as
  // .hybrid-marker widget spans inside a heading while the caret is on it.
  // Strip them so the outline shows the clean heading text, not the markup.
  function headingText(el: HTMLElement): string {
    const clone = el.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.hybrid-marker').forEach((m) => m.remove())
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
  }

  // Park the button (and panel) in the left gutter, just outside the
  // centered content column, rather than the viewport corner. The column is
  // centered (max-width), so its left edge moves with the window — measure it
  // live rather than hard-coding the layout constants.
  function positionButton(): void {
    const tab = tm.active()
    const content = tab?.dom.editorElement.querySelector<HTMLElement>(
      '.ProseMirror',
    )
    if (!content) return
    const contentLeft =
      content.getBoundingClientRect().left - host.getBoundingClientRect().left
    const left = Math.max(8, Math.round(contentLeft - BUTTON_GAP - BUTTON_SIZE))
    button.style.left = `${left}px`
    panel.style.left = `${left}px`
  }

  function rebindScroll(scrollEl: HTMLElement | null): void {
    if (scrollEl === boundScrollEl) return
    boundScrollEl?.removeEventListener('scroll', onScroll)
    boundScrollEl = scrollEl
    boundScrollEl?.addEventListener('scroll', onScroll, { passive: true })
  }

  function onScroll(): void {
    if (rafPending) return
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      updateActive()
    })
  }

  function scrollToEntry(entry: HeadingEntry): void {
    const scrollEl = tm.active()?.dom.hybridContainer
    if (!scrollEl) return
    const offset =
      entry.el.getBoundingClientRect().top -
      scrollEl.getBoundingClientRect().top
    const target = scrollEl.scrollTop + offset - 24
    scrollEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }

  function updateActive(): void {
    const scrollEl = tm.active()?.dom.hybridContainer
    if (!scrollEl || entries.length === 0) return
    const scTop = scrollEl.getBoundingClientRect().top
    let idx = -1
    // Entries are in document order, so their tops increase monotonically:
    // the active section is the last heading that has crossed the line.
    for (let i = 0; i < entries.length; i++) {
      const top = entries[i].el.getBoundingClientRect().top - scTop
      if (top <= ACTIVATION_OFFSET) idx = i
      else break
    }
    if (idx === activeIndex) return
    activeIndex = idx
    if (panelOpen) applyActiveClass()
  }

  function applyActiveClass(): void {
    const items = panel.querySelectorAll<HTMLElement>('.toc-item')
    items.forEach((item, i) => {
      const on = i === activeIndex
      item.classList.toggle('is-active', on)
      if (on) item.scrollIntoView({ block: 'nearest' })
    })
  }

  function renderPanel(): void {
    panel.replaceChildren()
    const title = document.createElement('div')
    title.className = 'toc-title'
    title.textContent = 'Contents'
    panel.appendChild(title)

    const minLevel = Math.min(...entries.map((e) => e.level))
    entries.forEach((entry, i) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'toc-item'
      item.textContent = entry.text || 'Untitled'
      item.title = entry.text
      item.style.paddingLeft = `${8 + (entry.level - minLevel) * 14}px`
      if (i === activeIndex) item.classList.add('is-active')
      item.addEventListener('click', () => {
        scrollToEntry(entry)
        closePanel()
      })
      panel.appendChild(item)
    })
  }

  function openPanel(): void {
    if (panelOpen) return
    panelOpen = true
    panel.classList.add('is-open')
    button.setAttribute('aria-expanded', 'true')
    positionButton()
    renderPanel()
    updateActive()
    applyActiveClass()
  }

  function closePanel(): void {
    if (!panelOpen) return
    panelOpen = false
    panel.classList.remove('is-open')
    button.setAttribute('aria-expanded', 'false')
  }

  function hide(): void {
    button.classList.remove('is-visible')
    closePanel()
    entries = []
    activeIndex = -1
  }

  function refresh(): void {
    const tab = tm.active()
    const scrollEl = tab?.dom.hybridContainer ?? null
    rebindScroll(scrollEl)

    if (!tab || isSourceMode(tab) || explorer.overlayOpen) {
      hide()
      return
    }
    entries = collectHeadings(tab)
    const scrollable = scrollEl
      ? scrollEl.scrollHeight > scrollEl.clientHeight + 4
      : false
    if (!scrollable || entries.length < MIN_HEADINGS) {
      hide()
      return
    }
    button.classList.add('is-visible')
    positionButton()
    if (panelOpen) renderPanel()
    updateActive()
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation()
    if (panelOpen) closePanel()
    else openPanel()
  })

  document.addEventListener('mousedown', (e) => {
    if (!panelOpen) return
    const t = e.target as Node | null
    if (!t || panel.contains(t) || button.contains(t)) return
    closePanel()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen) {
      e.preventDefault()
      closePanel()
      button.focus()
    }
  })

  // Resizing the window changes both whether the doc overflows (button
  // visibility) and heading offsets (active section).
  let resizeRaf = false
  window.addEventListener('resize', () => {
    if (resizeRaf) return
    resizeRaf = true
    requestAnimationFrame(() => {
      resizeRaf = false
      refresh()
    })
  })

  explorer.onChange(refresh)

  return { refresh }
}
