import { Clipboard, Events } from '@wailsio/runtime'
import type { Tab } from '../app/tab'
import type { TabManager } from '../app/tabManager'
import { OpenInNewWindow, RenameFile, RevealInFinder, SaveFileDialog, WriteFile } from '../app/ipc'
import { confirmDialog } from '../ui/confirmDialog'

export async function confirmDiscard(tab: Tab): Promise<boolean> {
  if (!tab.modified) return true
  return confirmDialog({
    title: 'Unsaved changes',
    message: `Discard unsaved changes to ${tab.fileName()}?`,
    confirmLabel: 'Discard',
    cancelLabel: 'Cancel',
  })
}

/** Close a tab by id. Ensures at least one tab remains open. */
export async function closeTab(tm: TabManager, id: string): Promise<boolean> {
  const tab = tm.tabs.find((t) => t.id === id)
  if (!tab) return false
  if (!(await confirmDiscard(tab))) return false
  tm.closeTab(id)
  if (tm.tabs.length === 0) tm.newTab()
  return true
}

/** Close the currently active tab. */
export async function closeActiveTab(tm: TabManager): Promise<boolean> {
  const id = tm.activeId
  if (!id) return false
  return closeTab(tm, id)
}

/** Close every tab except the one with the given id. */
export async function closeOtherTabs(tm: TabManager, keepId: string): Promise<void> {
  const ids = tm.tabs.filter((t) => t.id !== keepId).map((t) => t.id)
  for (const id of ids) {
    if (!(await closeTab(tm, id))) return
  }
}

/** Close every tab to the right of the one with the given id. */
export async function closeTabsToTheRight(tm: TabManager, anchorId: string): Promise<void> {
  const anchorIdx = tm.tabs.findIndex((t) => t.id === anchorId)
  if (anchorIdx < 0) return
  const ids = tm.tabs.slice(anchorIdx + 1).map((t) => t.id)
  for (const id of ids) {
    if (!(await closeTab(tm, id))) return
  }
}

/**
 * Wire native context menu events from the Go side. Each event carries the
 * clicked tab's id as data, and `sender` is the window name where the
 * right-click happened — used to ignore events meant for other windows.
 *
 * The "tab:openInNewWindow" handler is a placeholder until Phase 4 lands the
 * window service.
 */
export function bindTabContextMenuEvents(tm: TabManager, myWindowName: string): void {
  function ifMine(handler: (id: string) => void) {
    return (ev: { data: unknown; sender?: string }): void => {
      if (ev.sender && ev.sender !== myWindowName) return
      const id = typeof ev.data === 'string' ? ev.data : ''
      if (!id) return
      handler(id)
    }
  }

  Events.On(
    'tab:close',
    ifMine((id) => {
      void closeTab(tm, id)
    }),
  )
  Events.On(
    'tab:closeOthers',
    ifMine((id) => {
      void closeOtherTabs(tm, id)
    }),
  )
  Events.On(
    'tab:closeRight',
    ifMine((id) => {
      void closeTabsToTheRight(tm, id)
    }),
  )
  Events.On(
    'tab:openInNewWindow',
    ifMine((id) => {
      void openTabInNewWindow(tm, id)
    }),
  )
  Events.On(
    'tab:revealInExplorer',
    ifMine((id) => {
      void revealTabInExplorer(tm, id)
    }),
  )
  Events.On(
    'tab:copyFileName',
    ifMine((id) => {
      void copyTabFileName(tm, id)
    }),
  )
}

async function revealTabInExplorer(tm: TabManager, id: string): Promise<void> {
  const tab = tm.tabs.find((t) => t.id === id)
  if (!tab || !tab.filePath) return // tab-untitled menu shouldn't even surface this
  try {
    await RevealInFinder(tab.filePath)
  } catch (err) {
    console.error('[tabs] reveal failed', err)
  }
}

/**
 * Rename the file backing a tab in its current directory. Returns true on
 * success. Refuses path separators in `newName` (Save As is the right tool
 * for moving a file).
 */
export async function renameTabFile(tab: Tab, newName: string): Promise<boolean> {
  const trimmed = newName.trim()
  if (!trimmed) return false
  if (trimmed === tab.fileName()) return true // no-op
  if (!tab.filePath) return false
  // Strip path separators to avoid accidental moves.
  if (trimmed.includes('/') || trimmed.includes('\\')) return false
  try {
    const newPath = await RenameFile(tab.filePath, trimmed)
    tab.setFilePath(newPath)
    return true
  } catch (err) {
    console.error('[tabs] rename failed', err)
    return false
  }
}

async function copyTabFileName(tm: TabManager, id: string): Promise<void> {
  const tab = tm.tabs.find((t) => t.id === id)
  if (!tab) return
  try {
    await Clipboard.SetText(tab.fileName())
  } catch (err) {
    console.error('[tabs] copy filename failed', err)
  }
}

/**
 * Move a tab into a new window. The tab is saved first so the new window can
 * load from disk — for an Untitled tab this means prompting Save As. We
 * always persist current edits before moving so the new window shows them.
 */
export async function openTabInNewWindow(tm: TabManager, id: string): Promise<void> {
  const tab = tm.tabs.find((t) => t.id === id)
  if (!tab) return
  if (!(await ensureTabSaved(tab))) return
  if (!tab.filePath) return // safety; ensureTabSaved should have set it
  await OpenInNewWindow(tab.filePath)
  tm.closeTab(id)
  if (tm.tabs.length === 0) tm.newTab()
}

/**
 * Ensure a specific tab is persisted to disk. Prompts Save As for an Untitled
 * tab; silently writes for a named tab with unsaved changes; no-ops for a
 * clean named tab. Returns false if the user cancels the Save As dialog.
 */
export async function ensureTabSaved(tab: Tab): Promise<boolean> {
  if (!tab.filePath) {
    const path = await SaveFileDialog(tab.filePath || 'Untitled.md')
    if (!path) return false
    await WriteFile(path, tab.getCurrentMarkdown())
    tab.setFilePath(path)
    tab.setModified(false)
    return true
  }
  if (tab.modified) {
    await WriteFile(tab.filePath, tab.getCurrentMarkdown())
    tab.setModified(false)
  }
  return true
}
