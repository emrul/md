import '../styles/tokens.css'
import '../styles/base.css'
import { Events, Window } from '@wailsio/runtime'
import { TabManager } from './tabManager'
import type { Tab } from './tab'
import { mountTitle } from './title'
import { registerCommands, installKeymap, commands } from '../commands'
import { bindTabContextMenuEvents } from '../services/tabs'
import { mountToolbar } from '../ui/toolbar'
import { mountStatusbar } from '../ui/statusbar'
import { mountTabStrip } from '../ui/tabStrip'
import { ReadFile } from './ipc'
import { loadPreferences } from './preferences'
import { bindBubbleMenu, createBubbleMenu } from '../ui/bubbleMenu'
import { mountCodeBlockLangPicker } from '../ui/codeBlockLangPicker'
import { mountTableToolbar } from '../ui/tableToolbar'
import { bindCanvasClick } from './canvasClick'

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
}

const tm = new TabManager({
  host,
  onAfterTabContentChange: refreshAll,
  onAfterSelectionUpdate: () => toolbar?.refresh(),
  onTabCreated: attachTabFeatures,
})
tm.onChange(refreshAll)

registerCommands(tm)
installKeymap()
mountTitle(tm)
toolbar = mountToolbar(tm)
statusbar = mountStatusbar(tm)
tabStrip = mountTabStrip(tm)

Events.On('command', (ev) => {
  const id = typeof ev.data === 'string' ? ev.data : ''
  if (id) commands.execute(id)
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
