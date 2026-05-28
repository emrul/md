import './styles.css'
import type { ExplorerState } from '../../app/explorerState'
import type { TabManager } from '../../app/tabManager'
import { mountTree, type TreeMount } from './Tree'
import {
  contextualRoot,
  homeDir,
  parentDir,
} from '../../services/workspace'
import { prefs, updatePreference } from '../../app/preferences'
import { registerExplorerCommands } from '../../commands/explorer'
import { log } from '../../services/log'

// Folder icon — neutral, consistent stroke weight. The dock can host a few
// more icons (search, outline, etc.) without redesign; each goes in a sibling
// button below this one.
const FOLDER_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 6.5a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
</svg>
`.trim()

const HEADER_GIT_ICON_SVG = `
<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v10"/><path d="M11 9V7a2 2 0 0 0-2-2H7"/><circle cx="5" cy="3" r="1.4"/><circle cx="11" cy="13" r="1.4"/><circle cx="5" cy="13" r="1.4"/></svg>
`.trim()

const ICON_UP = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3"/><path d="M3.5 7.5L8 3l4.5 4.5"/></svg>`
const ICON_HOME = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7L8 2.5 13.5 7v6a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V7z"/><path d="M6.5 14.5v-4h3v4"/></svg>`
const ICON_RESET = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>`
// Text glyph rather than an SVG — `.*` reads as a clear hidden-files indicator
// for the technical user audience (regex/glob convention).
const ICON_DOTFOLDER = `<span class="explorer-header-dotfolders-glyph">.*</span>`

/**
 * basename — last path segment. Handles posix and Windows paths.
 * Returns the input unchanged for FS roots ("/", "C:\\", etc.) so the
 * header doesn't go blank.
 */
function basename(path: string): string {
  if (!path) return ''
  if (path === '/') return '/'
  if (/^[A-Za-z]:[\\/]?$/.test(path)) return path
  const parts = path.split(/[/\\]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function makeIconBtn(cls: string, svg: string, tooltip: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `explorer-header-btn ${cls}`
  b.title = tooltip
  b.setAttribute('aria-label', tooltip)
  b.innerHTML = svg
  return b
}

export interface ExplorerMount {
  dispose: () => void
}

export function mountExplorer(state: ExplorerState, tm: TabManager): ExplorerMount {
  // --- Dock ---
  const dock = document.createElement('div')
  dock.className = 'explorer-dock'

  const toggleBtn = document.createElement('button')
  toggleBtn.type = 'button'
  toggleBtn.className = 'explorer-dock-btn'
  toggleBtn.title = 'Toggle Files (⌘⇧E)'
  toggleBtn.setAttribute('aria-label', 'Toggle Files')
  toggleBtn.setAttribute('aria-pressed', String(state.overlayOpen))
  toggleBtn.innerHTML = FOLDER_ICON_SVG
  toggleBtn.addEventListener('click', () => state.toggleOverlay())
  dock.appendChild(toggleBtn)

  // --- Overlay ---
  const overlay = document.createElement('div')
  overlay.className = 'explorer-overlay'
  overlay.style.width = `${state.overlayWidth}px`
  overlay.setAttribute('role', 'region')
  overlay.setAttribute('aria-label', 'Files panel')

  // --- Header ---
  //  [Up] [Home] [Root]   name ⫶git   [Reset]
  const header = document.createElement('header')
  header.className = 'explorer-overlay-header'

  const headerNav = document.createElement('div')
  headerNav.className = 'explorer-header-nav'
  const btnUp = makeIconBtn('is-up', ICON_UP, 'Up one level')
  const btnHome = makeIconBtn('is-home', ICON_HOME, 'Home')
  headerNav.append(btnUp, btnHome)

  const headerName = document.createElement('span')
  headerName.className = 'explorer-header-name'
  headerName.textContent = 'Files'

  const headerGitIcon = document.createElement('span')
  headerGitIcon.className = 'explorer-header-git'
  headerGitIcon.innerHTML = HEADER_GIT_ICON_SVG
  headerGitIcon.title = 'Git repository'
  headerGitIcon.hidden = true

  const btnDotFolders = makeIconBtn('is-dotfolders', ICON_DOTFOLDER, 'Show hidden folders')
  btnDotFolders.classList.add('explorer-header-dotfolders')
  btnDotFolders.setAttribute('aria-pressed', String(prefs().showDotFolders))

  const btnReset = makeIconBtn('is-reset', ICON_RESET, 'Reset pinned root')
  btnReset.classList.add('explorer-header-reset')
  btnReset.hidden = true

  header.append(headerNav, headerName, headerGitIcon, btnDotFolders, btnReset)

  const body = document.createElement('div')
  body.className = 'explorer-overlay-body'

  const tree: TreeMount = mountTree(body, state, tm)
  registerExplorerCommands(tm, tree)

  // --- Nav state caches ---
  // Home is app-stable; fetched once on first overlay open.
  // parentOfRoot is recomputed after each setRoot.
  let homeDirCache = ''
  let parentOfRoot = ''

  async function loadAppStables(): Promise<void> {
    if (homeDirCache) return
    try {
      homeDirCache = await homeDir()
    } catch (err) {
      log.error('explorer', `nav caches: ${(err as Error).message ?? String(err)}`)
    }
  }

  function updateHeaderButtons(): void {
    const { path: rootPath } = tree.getRoot()
    btnUp.disabled = !rootPath || parentOfRoot === rootPath
    btnHome.disabled = !homeDirCache || rootPath === homeDirCache
    btnReset.hidden = state.pinnedRoot === null
  }

  /**
   * Sync the header text to the tree's current root. When no root has
   * resolved (initial state, or future error fallbacks), shows "Files".
   * When the effective root is the user's home, shows "Home" rather than
   * the home folder's basename — the disabled Home button alone isn't
   * enough of a cue that you're at $HOME.
   */
  function updateHeader(): void {
    const { path, gitRoot } = tree.getRoot()
    if (!path) {
      headerName.textContent = 'Files'
      header.removeAttribute('title')
      header.removeAttribute('aria-label')
      headerGitIcon.hidden = true
    } else {
      const isHome = homeDirCache !== '' && path === homeDirCache
      headerName.textContent = isHome ? 'Home' : basename(path)
      header.title = path
      header.setAttribute('aria-label', path)
      headerGitIcon.hidden = !(gitRoot && gitRoot === path)
    }
    updateHeaderButtons()
  }

  // --- Effective root: pin overrides contextual ---
  let rootLoading = false

  async function applyEffectiveRoot(): Promise<void> {
    if (rootLoading) return
    rootLoading = true
    try {
      // Always compute and store contextual root, even when a pin is active —
      // state.setPinIntent uses it to decide whether to drop a no-op pin,
      // and Reset's fallback target is the contextual root.
      const filePath = tm.active()?.filePath ?? ''
      const contextual = await contextualRoot(filePath)
      state.setContextualRoot(contextual)

      const target = state.pinnedRoot ?? contextual
      await tree.setRoot(target)
      try {
        parentOfRoot = await parentDir(target)
      } catch {
        parentOfRoot = target
      }
      updateHeader()
    } catch (err) {
      log.error('explorer', `root resolution: ${(err as Error).message ?? String(err)}`)
    } finally {
      rootLoading = false
    }
  }

  // --- Header button handlers ---
  // All pin-setters route through setPinIntent so the pin is only set when it
  // actually overrides the contextual root. Result: Reset only appears when
  // it has something meaningful to do.
  btnUp.addEventListener('click', () => {
    const { path } = tree.getRoot()
    if (!path || !parentOfRoot || parentOfRoot === path) return
    state.setPinIntent(parentOfRoot)
  })
  btnHome.addEventListener('click', () => {
    if (!homeDirCache) return
    state.setPinIntent(homeDirCache)
  })
  btnReset.addEventListener('click', () => {
    state.setPinnedRoot(null)
  })
  btnDotFolders.addEventListener('click', () => {
    const next = !prefs().showDotFolders
    updatePreference('showDotFolders', next)
    btnDotFolders.setAttribute('aria-pressed', String(next))
    btnDotFolders.title = next ? 'Hide hidden folders' : 'Show hidden folders'
    btnDotFolders.setAttribute('aria-label', btnDotFolders.title)
    // Re-fetch every cached listing with the new filter applied.
    void tree.refresh()
  })

  // Move keyboard focus into the tree once the slide-in finishes.
  function focusTreeAfterTransition(): void {
    setTimeout(() => {
      if (state.overlayOpen) tree.focus()
    }, 220)
  }

  const resizeHandle = document.createElement('div')
  resizeHandle.className = 'explorer-overlay-resize'
  resizeHandle.setAttribute('role', 'separator')
  resizeHandle.setAttribute('aria-orientation', 'vertical')
  resizeHandle.setAttribute('aria-label', 'Resize Files panel')

  overlay.append(header, body, resizeHandle)
  document.body.append(dock, overlay)

  // --- State <-> DOM sync ---
  let prevOpen = state.overlayOpen
  let prevPinnedRoot = state.pinnedRoot
  const applyState = (): void => {
    const justOpened = !prevOpen && state.overlayOpen
    const justClosed = prevOpen && !state.overlayOpen
    const pinChanged = state.pinnedRoot !== prevPinnedRoot
    prevOpen = state.overlayOpen
    prevPinnedRoot = state.pinnedRoot

    overlay.classList.toggle('is-open', state.overlayOpen)
    overlay.style.width = `${state.overlayWidth}px`
    dock.style.left = state.overlayOpen ? `${state.overlayWidth}px` : '0px'
    toggleBtn.setAttribute('aria-pressed', String(state.overlayOpen))
    updateHeaderButtons() // pinChanged toggles Reset visibility

    if (justOpened) {
      void loadAppStables().then(applyEffectiveRoot)
      focusTreeAfterTransition()
    } else if (justClosed) {
      // Return focus to the editor so the user keeps typing without
      // having to click back in.
      tm.active()?.editor.commands.focus()
    } else if (pinChanged && state.overlayOpen) {
      // Pin mutated while open (Up/Home/Root/Reset clicked, or future
      // row-pin clicked). Recompute effective root immediately.
      void applyEffectiveRoot()
    }
  }
  applyState()
  const unsubscribe = state.onChange(applyState)

  // --- Resize drag ---
  const onResizeDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    resizeHandle.classList.add('is-dragging')
    document.body.classList.add('explorer-resizing')

    const startX = e.clientX
    const startWidth = state.overlayWidth

    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX
      state.setOverlayWidth(startWidth + dx)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      resizeHandle.classList.remove('is-dragging')
      document.body.classList.remove('explorer-resizing')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  resizeHandle.addEventListener('mousedown', onResizeDown)

  // --- Click-outside dismissal ---
  // Closes the overlay when a mousedown lands outside both the overlay and
  // the dock. Inline rename inputs live inside the overlay, so they're not
  // affected; native context menus and OS dialogs don't bubble through
  // document mousedown so they're naturally excluded.
  const onDocumentMouseDown = (e: MouseEvent): void => {
    if (!state.overlayOpen) return
    const target = e.target as Node | null
    if (!target) return
    if (overlay.contains(target)) return
    if (dock.contains(target)) return
    state.setOverlayOpen(false)
  }
  document.addEventListener('mousedown', onDocumentMouseDown)

  // Drag-from-tree → editor drop fires this so the overlay closes once the
  // link has been inserted. The drop target isn't part of the overlay so
  // click-outside doesn't catch it (drop isn't a mousedown).
  const onExplorerDismiss = (): void => {
    state.setOverlayOpen(false)
  }
  window.addEventListener('explorer:dismiss', onExplorerDismiss)

  // Esc closes the overlay when focus is inside the panel and we're not in
  // a text input (so Esc in the inline rename still cancels rename without
  // double-dismissing). The input handlers stopPropagation on their own
  // keydowns, which is what saves us here.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    if (!state.overlayOpen) return
    const target = e.target as HTMLElement | null
    if (!target || !overlay.contains(target)) return
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
    e.preventDefault()
    state.setOverlayOpen(false)
  }
  document.addEventListener('keydown', onKeyDown)

  return {
    dispose(): void {
      unsubscribe()
      tree.dispose()
      resizeHandle.removeEventListener('mousedown', onResizeDown)
      document.removeEventListener('mousedown', onDocumentMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('explorer:dismiss', onExplorerDismiss)
      dock.remove()
      overlay.remove()
    },
  }
}
