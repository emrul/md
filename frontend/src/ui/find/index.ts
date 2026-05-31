import './find.css'
import type { TabManager } from '../../app/tabManager'
import type { Tab } from '../../app/tab'
import type { FindState } from '../../app/findState'
import type { FindResult } from '../../editor/find/types'
import type { GutterRail } from '../gutterRail'

// Magnifier glyph, matching the line-icon style used by the ToC rail button.
const FIND_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/></svg>`

// Vertical gap from the rail button's top to its panel (button height + gap;
// keep in sync with the .find-button size in find.css). Mirrors the ToC's.
const PANEL_OFFSET = 40
// Debounce (ms) for re-running the query as the user types / edits the doc.
// No in-repo precedent for the interval; tuned by feel.
const QUERY_DEBOUNCE = 150
const EDIT_REFRESH_DEBOUNCE = 150

/**
 * Mount the in-document find panel: a gutter-rail button (order 5, above ToC)
 * plus a floating DOM panel anchored under it. Unlike the ToC button, Find is
 * visible whenever a document is open, in every mode. The panel subscribes to
 * FindState (the session) and renders; all verbs route through the command
 * registry / FindState. See ../../../md-pro/docs/find.md.
 */
export function mountFind(
  findState: FindState,
  tm: TabManager,
  host: HTMLElement,
  rail: GutterRail,
): { refresh: () => void } {
  // --- DOM ------------------------------------------------------------------
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'find-button'
  button.title = 'Find (⌘F)'
  button.setAttribute('aria-label', 'Find in document')
  button.setAttribute('aria-haspopup', 'true')
  button.setAttribute('aria-expanded', 'false')
  button.innerHTML = FIND_ICON

  const panel = document.createElement('div')
  panel.className = 'find-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Find and replace')
  panel.innerHTML = `
    <div class="find-row find-row-query">
      <button type="button" class="find-mode-toggle" title="Toggle replace">Find<span class="find-caret">▾</span></button>
      <div class="find-input-wrap">
        <input type="text" class="find-input find-query" placeholder="Find" aria-label="Find" spellcheck="false" />
        <div class="find-options">
          <button type="button" class="find-opt" data-opt="caseSensitive" title="Match case" aria-label="Match case">Aa</button>
          <button type="button" class="find-opt" data-opt="wholeWord" title="Whole word" aria-label="Whole word">W</button>
          <button type="button" class="find-opt" data-opt="regex" title="Regular expression" aria-label="Regular expression">.*</button>
        </div>
      </div>
      <span class="find-counter" aria-live="polite"></span>
      <button type="button" class="find-nav find-prev" title="Previous (⇧⏎)" aria-label="Previous match">▲</button>
      <button type="button" class="find-nav find-next" title="Next (⏎)" aria-label="Next match">▼</button>
      <button type="button" class="find-close" title="Close (Esc)" aria-label="Close">✕</button>
    </div>
    <div class="find-row find-row-replace">
      <span class="find-with">With</span>
      <input type="text" class="find-input find-replace" placeholder="Replace" aria-label="Replace with" spellcheck="false" />
      <button type="button" class="find-replace-one" title="Replace">Replace</button>
      <button type="button" class="find-replace-all" title="Replace all">All</button>
    </div>
    <div class="find-results" role="listbox" aria-label="Matches"></div>`

  host.append(panel)

  const queryInput = panel.querySelector<HTMLInputElement>('.find-query')!
  const replaceInput = panel.querySelector<HTMLInputElement>('.find-replace')!
  const counter = panel.querySelector<HTMLElement>('.find-counter')!
  const modeToggle = panel.querySelector<HTMLButtonElement>('.find-mode-toggle')!
  const results = panel.querySelector<HTMLElement>('.find-results')!
  const optButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>('.find-opt'))
  const prevBtn = panel.querySelector<HTMLButtonElement>('.find-prev')!
  const nextBtn = panel.querySelector<HTMLButtonElement>('.find-next')!

  // The rail owns the button's position + vertical slot; we mirror the panel
  // under it whenever the slot moves.
  // Order 15 sits below ToC (10) and above any pro items like Change History (20).
  const railHandle = rail.register({ id: 'find', order: 15, button })
  railHandle.onLayout((top) => positionPanel(top))

  // --- state ----------------------------------------------------------------
  let overlayActive = false
  let lastTabId: string | null = null
  let lastMode: string | undefined
  let overlayUnsub: (() => void) | null = null
  let editRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let queryTimer: ReturnType<typeof setTimeout> | null = null
  let renderedListKey = ''

  function railTop(): number {
    return parseInt(button.style.top || '12', 10) || 12
  }
  function positionPanel(top: number = railTop()): void {
    panel.style.left = button.style.left
    panel.style.top = `${top + PANEL_OFFSET}px`
  }

  // --- rendering ------------------------------------------------------------
  function counterText(r: FindResult): string {
    if (!findState.hasText()) return ''
    if (!r.valid) return '' // invalidity is signalled on the input instead
    if (r.total === 0) return '0/0'
    const pos = r.active >= 0 ? r.active + 1 : '–'
    return `${pos}/${r.total}${r.capped ? '+' : ''}`
  }

  function renderResultsList(r: FindResult): void {
    const opts = findState.options
    // Rebuild the list only when the match *set* changes; pure navigation just
    // re-marks the active row (avoids re-creating hundreds of rows per ⏎).
    const key = `${findState.text}|${opts.caseSensitive}|${opts.wholeWord}|${opts.regex}|${r.total}|${r.capped}`
    if (key !== renderedListKey) {
      renderedListKey = key
      results.replaceChildren()
      for (const m of r.matches) {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'find-result'
        row.dataset.index = String(m.index)
        const locator = m.line != null ? `L${m.line}` : (m.section ?? '')
        const snippet =
          `<span class="find-snip-before"></span>` +
          `<mark class="find-snip-hit"></mark>` +
          `<span class="find-snip-after"></span>`
        row.innerHTML = `<span class="find-loc"></span><span class="find-snip">${snippet}</span>`
        row.querySelector('.find-loc')!.textContent = locator
        row.querySelector('.find-snip-before')!.textContent = m.before
        row.querySelector('.find-snip-hit')!.textContent = m.hit
        row.querySelector('.find-snip-after')!.textContent = m.after
        row.addEventListener('click', (e) => {
          e.stopPropagation()
          findState.goto(m.index)
        })
        results.appendChild(row)
      }
      if (r.capped) {
        const more = document.createElement('div')
        more.className = 'find-more'
        more.textContent = `Showing first ${r.matches.length} matches`
        results.appendChild(more)
      }
    }
    const rows = results.querySelectorAll<HTMLElement>('.find-result')
    rows.forEach((row, i) => {
      const on = i === r.active
      row.classList.toggle('is-active', on)
      if (on) row.scrollIntoView({ block: 'nearest' })
    })
    results.style.display = r.matches.length ? '' : 'none'
  }

  function render(): void {
    const open = findState.isOpen && !overlayActive && !!tm.active()
    panel.classList.toggle('is-open', open)
    button.classList.toggle('is-active', open)
    button.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (!open) return

    const r = findState.result
    const replace = findState.mode === 'replace'
    panel.classList.toggle('is-replace', replace)
    modeToggle.firstChild!.textContent = replace ? 'Replace' : 'Find'

    if (queryInput.value !== findState.text) queryInput.value = findState.text
    if (replaceInput.value !== findState.replacementText) {
      replaceInput.value = findState.replacementText
    }

    const opts = findState.options
    optButtons.forEach((b) => {
      const key = b.dataset.opt as 'caseSensitive' | 'wholeWord' | 'regex'
      b.classList.toggle('is-on', opts[key])
      b.setAttribute('aria-pressed', opts[key] ? 'true' : 'false')
    })

    const invalid = findState.hasText() && !r.valid
    queryInput.classList.toggle('is-invalid', invalid)
    counter.textContent = counterText(r)

    const noNav = invalid || r.total === 0
    prevBtn.disabled = noNav
    nextBtn.disabled = noNav

    positionPanel()
    renderResultsList(r)
  }

  // --- visibility / change detection ---------------------------------------
  function bindTab(tab: Tab | null): void {
    overlayUnsub?.()
    overlayUnsub = null
    overlayActive = tab?.viewController?.overlayOpen ?? false
    if (!tab?.viewController) return
    overlayUnsub = tab.viewController.onOverlayChange(() => {
      const open = tab.viewController?.overlayOpen ?? false
      if (open === overlayActive) return
      overlayActive = open
      if (open) tab.viewController?.find.clear()
      railHandle.setVisible(!open && !!tm.active())
      if (!open && findState.isOpen) findState.reTarget()
      render()
    })
  }

  function refresh(): void {
    const tab = tm.active()
    const tabId = tab?.id ?? null
    const mode = tab?.viewController?.mode
    const tabChanged = tabId !== lastTabId
    const modeChanged = !tabChanged && mode !== lastMode
    if (tabChanged) bindTab(tab)
    lastTabId = tabId
    lastMode = mode

    railHandle.setVisible(!!tab && !overlayActive)
    positionPanel()

    if (findState.isOpen && tab && !overlayActive) {
      if (tabChanged || modeChanged) findState.reTarget()
      else scheduleEditRefresh()
    }
    render()
  }

  function scheduleEditRefresh(): void {
    if (editRefreshTimer) clearTimeout(editRefreshTimer)
    editRefreshTimer = setTimeout(() => findState.refresh(), EDIT_REFRESH_DEBOUNCE)
  }

  // --- events ---------------------------------------------------------------
  button.addEventListener('click', (e) => {
    e.stopPropagation()
    if (findState.isOpen) findState.close()
    else findState.open('find')
  })

  // Clicks inside the panel never bubble to the document close-on-click-away.
  panel.addEventListener('mousedown', (e) => e.stopPropagation())

  queryInput.addEventListener('input', () => {
    if (queryTimer) clearTimeout(queryTimer)
    const value = queryInput.value
    queryTimer = setTimeout(() => findState.setText(value), QUERY_DEBOUNCE)
  })
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (queryTimer) {
        clearTimeout(queryTimer)
        findState.setText(queryInput.value)
      }
      if (e.shiftKey) findState.prev()
      else findState.next()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeAndReturnFocus()
    }
  })

  replaceInput.addEventListener('input', () => findState.setReplacement(replaceInput.value))
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      findState.setReplacement(replaceInput.value)
      findState.replaceOne()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeAndReturnFocus()
    }
  })

  modeToggle.addEventListener('click', (e) => {
    e.stopPropagation()
    findState.setMode(findState.mode === 'find' ? 'replace' : 'find')
    if (findState.mode === 'replace') replaceInput.focus()
    else queryInput.focus()
  })

  optButtons.forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      findState.toggleOption(b.dataset.opt as 'caseSensitive' | 'wholeWord' | 'regex')
      queryInput.focus()
    })
  })

  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    findState.prev()
  })
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    findState.next()
  })
  panel.querySelector('.find-replace-one')!.addEventListener('click', (e) => {
    e.stopPropagation()
    findState.replaceOne()
  })
  panel.querySelector('.find-replace-all')!.addEventListener('click', (e) => {
    e.stopPropagation()
    findState.replaceAll()
  })
  panel.querySelector('.find-close')!.addEventListener('click', (e) => {
    e.stopPropagation()
    closeAndReturnFocus()
  })

  function closeAndReturnFocus(): void {
    findState.close()
    tm.active()?.viewController?.focus()
  }

  // Click into the document (outside panel + button) closes the panel but keeps
  // the session — Cmd/Ctrl+G still works with it closed.
  document.addEventListener('mousedown', (e) => {
    if (!findState.isOpen) return
    const t = e.target as Node | null
    if (!t || panel.contains(t) || button.contains(t)) return
    findState.close()
  })

  // --- subscriptions --------------------------------------------------------
  findState.onChange(render)
  findState.onFocusRequest(() => {
    if (!findState.isOpen || overlayActive) return
    const input = findState.mode === 'replace' ? replaceInput : queryInput
    // Defer one frame so the panel is laid out (is-open) before we focus.
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  })

  let resizeRaf = false
  window.addEventListener('resize', () => {
    if (resizeRaf) return
    resizeRaf = true
    requestAnimationFrame(() => {
      resizeRaf = false
      positionPanel()
    })
  })

  return { refresh }
}
