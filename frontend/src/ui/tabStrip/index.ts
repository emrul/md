import type { Tab } from '../../app/tab'
import type { TabManager } from '../../app/tabManager'
import { closeTab as closeTabSvc, ensureTabSaved, renameTabFile } from '../../services/tabs'
import './tabStrip.css'

export interface TabStripHandle {
  refresh: () => void
}

// One click of < or > scrolls by this many px. Matches the fixed tab width so
// each click moves by ~one tab.
const SCROLL_STEP = 180

export function mountTabStrip(tm: TabManager): TabStripHandle {
  const strip = document.getElementById('tab-strip')
  if (!strip) throw new Error('#tab-strip mount point missing')
  const stripEl: HTMLElement = strip

  // Wrap the static strip in a flex container that also holds the < > scroll
  // buttons. Done at mount so index.html can stay simple.
  const wrapper = document.createElement('div')
  wrapper.className = 'tab-strip-wrapper'
  stripEl.parentElement?.insertBefore(wrapper, stripEl)
  wrapper.appendChild(stripEl)

  const controls = document.createElement('div')
  controls.className = 'tab-scroll-controls is-hidden'
  const leftBtn = document.createElement('button')
  leftBtn.type = 'button'
  leftBtn.className = 'tab-scroll-btn'
  leftBtn.textContent = '‹'
  leftBtn.setAttribute('aria-label', 'Scroll tabs left')
  const rightBtn = document.createElement('button')
  rightBtn.type = 'button'
  rightBtn.className = 'tab-scroll-btn'
  rightBtn.textContent = '›'
  rightBtn.setAttribute('aria-label', 'Scroll tabs right')
  controls.append(leftBtn, rightBtn)
  wrapper.appendChild(controls)

  // Rename state. Persists across refresh() calls so external tab-list updates
  // (other tabs opening/closing) don't kill an in-progress rename.
  let renamingId: string | null = null
  let renameValue = ''
  let focusAfterRefresh = false

  function startRename(tab: Tab): void {
    if (!tab.filePath) {
      // Untitled tab: Save As becomes the rename UX. After saving, the file
      // exists with the chosen name; the tab strip refreshes via setFilePath.
      void ensureTabSaved(tab)
      return
    }
    renamingId = tab.id
    renameValue = tab.fileName()
    focusAfterRefresh = true
    refresh()
  }

  async function commitRename(tab: Tab): Promise<void> {
    const value = renameValue
    renamingId = null
    if (value && value !== tab.fileName()) {
      await renameTabFile(tab, value)
    }
    refresh()
  }

  function cancelRename(): void {
    renamingId = null
    refresh()
  }

  function renderRenameInput(tab: Tab): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'tab-rename'
    input.value = renameValue
    input.spellcheck = false
    input.autocomplete = 'off'

    input.addEventListener('input', () => {
      renameValue = input.value
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void commitRename(tab)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelRename()
      }
    })

    input.addEventListener('blur', () => {
      if (renamingId === tab.id) cancelRename()
    })

    // Prevent the surrounding .tab mousedown handler from switching tabs or
    // triggering the rename a second time.
    input.addEventListener('mousedown', (e) => e.stopPropagation())
    input.addEventListener('dblclick', (e) => e.stopPropagation())

    return input
  }

  function renderTab(tab: Tab): HTMLElement {
    const el = document.createElement('div')
    el.className = 'tab'
    el.dataset.tabId = tab.id
    // Wails native context menu hook — see registerTabContextMenu in menu.go.
    // Saved tabs get the full menu (including Show in Finder); Untitled tabs
    // get a shorter menu without it.
    el.style.setProperty('--custom-contextmenu', tab.filePath ? 'tab-saved' : 'tab-untitled')
    el.style.setProperty('--custom-contextmenu-data', tab.id)
    if (tab.id === tm.activeId) el.classList.add('is-active')
    if (tab.modified) el.classList.add('is-modified')
    if (tab.id === renamingId) el.classList.add('is-renaming')

    const dirty = document.createElement('span')
    dirty.className = 'tab-dirty'

    let nameEl: HTMLElement
    if (tab.id === renamingId) {
      nameEl = renderRenameInput(tab)
    } else {
      const name = document.createElement('span')
      name.className = 'tab-name'
      name.textContent = tab.fileName()
      name.addEventListener('dblclick', (e) => {
        e.preventDefault()
        e.stopPropagation()
        startRename(tab)
      })
      nameEl = name
    }

    const close = document.createElement('button')
    close.className = 'tab-close'
    close.type = 'button'
    close.title = 'Close'
    close.setAttribute('aria-label', 'Close tab')
    close.textContent = '×'

    el.append(dirty, nameEl, close)

    el.addEventListener('mousedown', (e) => {
      // Middle-click closes the tab; ignore right-click (reserved for context menu)
      if (e.button === 1) {
        e.preventDefault()
        void closeTabSvc(tm, tab.id)
        return
      }
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('.tab-close')) return
      if (tab.id === renamingId) return // don't reswitch while editing
      // If another tab is being renamed, clicking elsewhere on the strip cancels
      // it. blur alone isn't reliable here: clicking a non-focusable .tab div
      // doesn't steal focus from the input in WKWebView.
      if (renamingId && renamingId !== tab.id) cancelRename()
      tm.setActive(tab.id)
    })

    close.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    close.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      void closeTabSvc(tm, tab.id)
    })

    return el
  }

  function updateScrollState(): void {
    const overflow = stripEl.scrollWidth > stripEl.clientWidth + 1
    controls.classList.toggle('is-hidden', !overflow)
    if (!overflow) {
      leftBtn.disabled = true
      rightBtn.disabled = true
      return
    }
    leftBtn.disabled = stripEl.scrollLeft <= 0
    rightBtn.disabled = stripEl.scrollLeft + stripEl.clientWidth >= stripEl.scrollWidth - 1
  }

  function refresh(): void {
    stripEl.replaceChildren(...tm.tabs.map(renderTab))
    wrapper.classList.toggle('is-single', tm.tabs.length <= 1)
    if (focusAfterRefresh && renamingId) {
      focusAfterRefresh = false
      const input = stripEl.querySelector<HTMLInputElement>(
        `.tab[data-tab-id="${renamingId}"] .tab-rename`,
      )
      if (input) {
        input.focus()
        // Select the basename without extension (VS Code convention).
        const dot = input.value.lastIndexOf('.')
        if (dot > 0) input.setSelectionRange(0, dot)
        else input.select()
      }
    }
    // After DOM is in place, defer the layout-dependent measurements.
    requestAnimationFrame(() => {
      scrollActiveIntoView()
      updateScrollState()
    })
  }

  function scrollActiveIntoView(): void {
    const id = tm.activeId
    if (!id) return
    const el = stripEl.querySelector<HTMLElement>(`.tab[data-tab-id="${id}"]`)
    if (!el) return
    const stripRect = stripEl.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    if (elRect.left < stripRect.left) {
      stripEl.scrollBy({ left: elRect.left - stripRect.left, behavior: 'smooth' })
    } else if (elRect.right > stripRect.right) {
      stripEl.scrollBy({ left: elRect.right - stripRect.right, behavior: 'smooth' })
    }
  }

  leftBtn.addEventListener('click', () => {
    stripEl.scrollBy({ left: -SCROLL_STEP, behavior: 'smooth' })
  })
  rightBtn.addEventListener('click', () => {
    stripEl.scrollBy({ left: SCROLL_STEP, behavior: 'smooth' })
  })

  // Translate vertical wheel into horizontal scroll for users on mice without
  // a tilt-wheel. Trackpad horizontal gestures already produce deltaX directly
  // and use the browser's default scroll.
  stripEl.addEventListener(
    'wheel',
    (e) => {
      if (e.deltaX === 0 && e.deltaY !== 0) {
        e.preventDefault()
        stripEl.scrollLeft += e.deltaY
      }
    },
    { passive: false },
  )

  stripEl.addEventListener('scroll', updateScrollState, { passive: true })

  // Watch for size changes (window resize, app layout shifts).
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(stripEl)
  } else {
    window.addEventListener('resize', updateScrollState)
  }

  tm.onChange(refresh)
  refresh()

  return { refresh }
}
