import { Events, Window } from '@wailsio/runtime'
import { TabManager } from './tabManager'
import { ExplorerState } from './explorerState'
import type { Tab } from './tab'
import { mountTitle } from './title'
import { registerCommands, installKeymap, commands } from '../commands'
import { bindTabContextMenuEvents } from '../services/tabs'
import { mountToolbar } from '../ui/toolbar'
import { mountStatusbar } from '../ui/statusbar'
import { mountTabStrip } from '../ui/tabStrip'
import { mountExplorer } from '../ui/explorer'
import { findGitRoot } from '../services/workspace'
import { ReadFile } from './ipc'
import { loadPreferences } from './preferences'
import { bindBubbleMenu, createBubbleMenu } from '../ui/bubbleMenu'
import { mountCodeBlockLangPicker } from '../ui/codeBlockLangPicker'
import { mountTableToolbar } from '../ui/tableToolbar'
import { bindCanvasClick } from './canvasClick'

export async function bootEditorWindow(): Promise<void> {
  const host = document.getElementById('tab-host')
  if (!host) throw new Error('#tab-host mount point missing')

  // Load preferences before anything else — feature flags affect mounting.
  const userPrefs = await loadPreferences()
  if (!userPrefs.useTabs) document.body.classList.add('no-tabs')

  let toolbar: { refresh: () => void } | null = null
  let statusbar: { refresh: () => void } | null = null
  let tabStrip: ReturnType<typeof mountTabStrip> | null = null

  function refreshAll(): void {
    toolbar?.refresh()
    statusbar?.refresh()
    tabStrip?.refresh()
  }

  function attachTabFeatures(tab: Tab): void {
    const refs = createBubbleMenu(tab.dom.bubbleMount)
    bindBubbleMenu(refs, tab)
    tab.disposables.push(mountCodeBlockLangPicker(tab.editor))
    tab.disposables.push(mountTableToolbar(tab.editor))
    bindCanvasClick(tab.editor)
    attachGitRootTracking(tab)
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
        tab.setGitRoot(null)
        return
      }
      const target = fp
      void findGitRoot(target)
        .then((root) => {
          if (tab.filePath === target) tab.setGitRoot(root || null)
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

  registerCommands(tm, explorerState)
  installKeymap()
  mountTitle(tm)
  toolbar = mountToolbar(tm)
  statusbar = mountStatusbar(tm)
  tabStrip = mountTabStrip(tm)
  mountExplorer(explorerState, tm)

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
  const myWindowName = await Window.Name()
  bindTabContextMenuEvents(tm, myWindowName)

  // Boot one tab. If the window was launched with ?file=<path> (e.g. from
  // "Open in New Window"), load that file as the initial tab.
  const initialFile = new URLSearchParams(window.location.search).get('file')
  if (initialFile) {
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
}
