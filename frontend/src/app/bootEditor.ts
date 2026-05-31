import { Events, Window } from '@wailsio/runtime'
import { TabManager } from './tabManager'
import { ExplorerState } from './explorerState'
import { FindState } from './findState'
import type { Tab } from './tab'
import { mountTitle } from './title'
import { registerCommands, installKeymap, commands } from '../commands'
import { features, type FeatureContext } from './features'
import { bindTabContextMenuEvents } from '../services/tabs'
import { mountToolbar } from '../ui/toolbar'
import { mountStatusbar } from '../ui/statusbar'
import { mountTabStrip } from '../ui/tabStrip'
import { mountExplorer } from '../ui/explorer'
import { mountToc } from '../ui/toc'
import { mountFind } from '../ui/find'
import { mountGutterRail } from '../ui/gutterRail'
import { findGitRoot, gitBranch } from '../services/workspace'
import { openPaths } from '../services/files'
import { getRestoreWindow, saveWindowContent, type SessionContent } from '../services/session'
import { ReadFile } from './ipc'
import { loadPreferences } from './preferences'
import { bindBubbleMenu, createBubbleMenu } from '../ui/bubbleMenu'
import { mountCodeBlockLangPicker } from '../ui/codeBlockLangPicker'
import { mountTableToolbar } from '../ui/tableToolbar'
import { bindCanvasClick } from './canvasClick'

// Breadcrumb via the global set by bootDiagnostics — NOT a static import, which
// would pull the entry chunk into this dynamically-imported chunk and deadlock
// V8 on the entry's top-level await. See bootDiagnostics.ts.
const markBootStep = (step: string): void => globalThis.__mdBootStep?.(step)

export async function bootEditorWindow(): Promise<void> {
  markBootStep('bootEditor: entered')
  const host = document.getElementById('tab-host')
  if (!host) throw new Error('#tab-host mount point missing')

  // Load preferences before anything else — feature flags affect mounting.
  markBootStep('bootEditor: awaiting loadPreferences()')
  const userPrefs = await loadPreferences()
  markBootStep('bootEditor: loadPreferences() done')
  if (!userPrefs.useTabs) document.body.classList.add('no-tabs')

  let toolbar: { refresh: () => void } | null = null
  let statusbar: { refresh: () => void } | null = null
  let tabStrip: ReturnType<typeof mountTabStrip> | null = null
  let toc: { refresh: () => void } | null = null
  let find: { refresh: () => void } | null = null

  function refreshAll(): void {
    toolbar?.refresh()
    statusbar?.refresh()
    tabStrip?.refresh()
    toc?.refresh()
    // The rail doesn't reflow on a mode switch on its own (that path fires only
    // onAfterTabContentChange, which the rail doesn't watch). Reposition here so
    // the always-visible Find button re-anchors to the new view; find.refresh()
    // re-targets the query and updates the panel.
    rail.reposition()
    find?.refresh()
  }

  function attachTabFeatures(tab: Tab): void {
    const refs = createBubbleMenu(tab.dom.bubbleMount)
    bindBubbleMenu(refs, tab)
    tab.disposables.push(mountCodeBlockLangPicker(tab.editor))
    tab.disposables.push(mountTableToolbar(tab.editor))
    bindCanvasClick(tab.editor)
    attachGitRootTracking(tab)
    for (const f of features()) f.attachTab?.(tab, featureCtx)
  }

  /**
   * Subscribe to filePath changes on a tab and keep its gitRoot field
   * up to date. Pure data — no UI side effects. Future features
   * (file history, diff view, etc.) will gate on tab.gitRoot.
   *
   * The "stale callback" guard handles a fast user flow: rename or Save
   * As happens while a previous FindGitRoot is still in flight; we only
   * write the result if the tab's filePath hasn't changed since.
   */
  function attachGitRootTracking(tab: Tab): void {
    let lastFilePath: string | null | undefined = undefined
    const sync = (): void => {
      const fp = tab.filePath
      if (fp === lastFilePath) return
      lastFilePath = fp
      if (!fp) {
        tab.setGit(null, null)
        return
      }
      const target = fp
      void findGitRoot(target)
        .then(async (root) => {
          if (tab.filePath !== target) return
          if (!root) {
            tab.setGit(null, null)
            return
          }
          const branch = await gitBranch(root).catch(() => '')
          if (tab.filePath !== target) return
          tab.setGit(root, branch || null)
        })
        .catch(() => {
          /* ignore — git detection isn't critical */
        })
    }
    sync()
    const unsub = tab.onChange(sync)
    tab.disposables.push({ destroy: unsub })
  }

  const tm = new TabManager({
    host,
    onAfterTabContentChange: refreshAll,
    onAfterSelectionUpdate: () => toolbar?.refresh(),
    onTabCreated: attachTabFeatures,
  })
  tm.onChange(refreshAll)

  const explorerState = new ExplorerState()
  // Window-level find session (query, options, mode, open/closed). Constructed
  // before registerCommands so the find.* handlers can flip it, and handed to
  // mountFind later so the panel subscribes to the same instance.
  const findState = new FindState(tm)
  // The left gutter rail owns positioning + vertical stacking for ToC, Find, and
  // any pro rail items (Change History). Constructed once, shared with mountToc /
  // mountFind and exposed to features via featureCtx.
  const rail = mountGutterRail(host, tm, explorerState)
  const featureCtx: FeatureContext = { tm, explorer: explorerState, rail }

  registerCommands(tm, explorerState, findState)
  for (const f of features()) f.registerCommands?.(featureCtx)
  installKeymap()
  mountTitle(tm)
  toolbar = mountToolbar(tm)
  statusbar = mountStatusbar(tm, explorerState)
  tabStrip = mountTabStrip(tm)
  mountExplorer(explorerState, tm)
  toc = mountToc(tm, explorerState, host, rail)
  find = mountFind(findState, tm, host, rail)
  for (const f of features()) f.mount?.(featureCtx)
  markBootStep('bootEditor: core UI mounted (toolbar/statusbar/explorer)')

  Events.On('command', (ev) => {
    // App-menu items emit a bare string ID. Context-menu items that need an
    // argument (e.g. explorer right-click on a path) emit { id, args }.
    const data = ev.data as unknown
    if (typeof data === 'string') {
      commands.execute(data)
    } else if (data && typeof data === 'object' && typeof (data as { id?: unknown }).id === 'string') {
      const { id, args } = data as { id: string; args?: unknown }
      commands.execute(id, args)
    }
  })

  // Wire native context-menu events from menu.go. Filtering by window name keeps
  // other windows' right-clicks from acting in this one.
  markBootStep('bootEditor: awaiting Window.Name()')
  const myWindowName = await Window.Name()
  markBootStep('bootEditor: Window.Name() done')
  bindTabContextMenuEvents(tm, myWindowName)

  /**
   * Reload a window's tabs + explorer panel from the saved session. The Go
   * side has already dropped tabs whose files no longer exist, so everything
   * here is openable. Cursor/scroll position is intentionally not restored.
   */
  async function restoreWindowState(id: string): Promise<void> {
    const data = await getRestoreWindow(id)
    if (!data || data.tabs.length === 0) {
      tm.newTab()
      return
    }
    // Apply explorer state before opening tabs so the first effective-root
    // resolution already sees the restored pin.
    if (data.explorer.width > 0) explorerState.setOverlayWidth(data.explorer.width)
    if (data.explorer.pinnedRoot) explorerState.setPinnedRoot(data.explorer.pinnedRoot)
    if (data.explorer.open) explorerState.setOverlayOpen(true)

    await openPaths(tm, data.tabs)
    if (data.activeTab) {
      const active = tm.tabs.find((t) => t.filePath === data.activeTab)
      if (active) tm.setActive(active.id)
    }
  }

  /**
   * Mirror this window's tabs + explorer state into the session store on every
   * structural change (debounced + deduped). Window geometry is tracked on the
   * Go side; here we only report content.
   */
  function installSessionReporting(id: string): void {
    let lastPayload = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    const report = (): void => {
      const content: SessionContent = {
        tabs: tm.tabs.map((t) => t.filePath).filter((p): p is string => !!p),
        activeTab: tm.active()?.filePath ?? '',
        explorer: {
          open: explorerState.overlayOpen,
          width: explorerState.overlayWidth,
          pinnedRoot: explorerState.pinnedRoot ?? '',
        },
      }
      const key = JSON.stringify(content)
      if (key === lastPayload) return
      lastPayload = key
      void saveWindowContent(id, content)
    }
    const schedule = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(report, 300)
    }
    tm.onChange(schedule)
    explorerState.onChange(schedule)
    report() // immediate initial snapshot
  }

  // Boot the initial tabs. Priority: restored session (?restore=<id>), then a
  // single file from "Open in New Window" (?file=<path>), else one Untitled.
  markBootStep('bootEditor: opening initial tabs')
  const params = new URLSearchParams(window.location.search)
  const restoreId = params.get('restore')
  const initialFile = params.get('file')
  if (restoreId) {
    await restoreWindowState(restoreId)
  } else if (initialFile) {
    try {
      const content = await ReadFile(initialFile)
      tm.newTab({ path: initialFile, content })
    } catch (err) {
      console.error('[boot] failed to load initial file', initialFile, err)
      tm.newTab()
    }
  } else {
    tm.newTab()
  }

  refreshAll()

  installSessionReporting(myWindowName)
  markBootStep('bootEditor: done')
}
