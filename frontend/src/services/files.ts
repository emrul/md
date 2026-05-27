import type { Tab } from '../app/tab'
import type { TabManager } from '../app/tabManager'
import { OpenFileDialog, ReadFile, SaveFileDialog, WriteFile } from '../app/ipc'
import { prefs } from '../app/preferences'
import { confirmDiscard } from './tabs'

// Schedule work during a browser idle slot. Falls back to a short timeout on
// platforms without requestIdleCallback (Safari < 18 etc).
const scheduleIdle: (cb: () => void) => void =
  typeof requestIdleCallback === 'function'
    ? (cb) => {
        requestIdleCallback(() => cb())
      }
    : (cb) => {
        setTimeout(cb, 1)
      }

/** Return the tab whose filePath matches the given path, or null. */
function findTabByPath(tm: TabManager, path: string): Tab | null {
  return tm.tabs.find((t) => t.filePath === path) ?? null
}

/** A throwaway tab: no file, no edits, no content typed in. */
function isEmptyUntitled(tab: Tab): boolean {
  if (tab.filePath !== null) return false
  if (tab.modified) return false
  if (tab.pendingContent !== null) return tab.pendingContent.trim() === ''
  return tab.getCurrentMarkdown().trim() === ''
}

/**
 * Close any tabs that are blank Untitled placeholders — used after opening
 * files so a leftover "Untitled" doesn't stack next to the freshly-opened
 * documents. tm.closeTab auto-creates an Untitled if nothing else remains, so
 * this is only meaningful when at least one new tab has been added first.
 */
function closeEmptyUntitledTabs(tm: TabManager): void {
  for (const tab of tm.tabs.filter(isEmptyUntitled)) {
    tm.closeTab(tab.id)
  }
}

/** Either add a new tab (tabs mode) or reload the active tab in place. */
async function loadIntoActiveOrNewTab(
  tm: TabManager,
  opts: { path: string | null; content: string },
): Promise<void> {
  if (prefs().useTabs) {
    tm.newTab({ path: opts.path, content: opts.content })
    return
  }
  const active = tm.active()
  if (!active) {
    tm.newTab({ path: opts.path, content: opts.content })
    return
  }
  if (!(await confirmDiscard(active))) return
  applyToTab(active, opts)
}

function applyToTab(tab: Tab, opts: { path: string | null; content: string }): void {
  tab.loadMarkdown(opts.content)
  tab.setFilePath(opts.path)
  tab.setModified(false)
}

export async function newFile(tm: TabManager): Promise<void> {
  await loadIntoActiveOrNewTab(tm, { path: null, content: '' })
}

export async function openFile(tm: TabManager): Promise<void> {
  let paths: string[]
  try {
    paths = await OpenFileDialog()
  } catch (err) {
    console.error('[files] open dialog failed', err)
    return
  }
  if (!paths || paths.length === 0) return

  if (paths.length === 1) {
    const path = paths[0]
    const existing = findTabByPath(tm, path)
    if (existing) {
      tm.setActive(existing.id)
      return
    }
    try {
      const content = await ReadFile(path)
      await loadIntoActiveOrNewTab(tm, { path, content })
      closeEmptyUntitledTabs(tm)
    } catch (err) {
      console.error('[files] could not open', path, err)
    }
    return
  }

  // Multi-select: always open as tabs (the preference only affects single-file
  // opens). Paths already open are switched to, not duplicated. The last item
  // in the selection becomes active, matching VS Code / Sublime behavior.
  // New tabs are created with defer:true so only the tab the user lands on
  // pays the markdown-parse + render cost up-front; the others materialize on
  // first switch.
  let lastTabId: string | null = null
  const newlyOpened: string[] = []
  for (const path of paths) {
    const existing = findTabByPath(tm, path)
    if (existing) {
      lastTabId = existing.id
      continue
    }
    try {
      const content = await ReadFile(path)
      const tab = tm.newTab({ path, content, defer: true })
      newlyOpened.push(tab.id)
      lastTabId = tab.id
    } catch (err) {
      console.error('[files] could not open', path, err)
    }
  }
  if (lastTabId) tm.setActive(lastTabId)
  closeEmptyUntitledTabs(tm)

  // Pre-warm the remaining deferred tabs during idle time. materialize() is
  // idempotent — if the user clicks one before its idle slot fires, setActive
  // materializes it synchronously and the idle call becomes a cheap no-op.
  for (const id of newlyOpened) {
    if (id === lastTabId) continue // already materialized by setActive above
    scheduleIdle(() => tm.materialize(id))
  }
}

export async function saveFile(tm: TabManager): Promise<void> {
  const tab = tm.active()
  if (!tab) return
  if (!tab.filePath) return saveFileAs(tm)
  try {
    await WriteFile(tab.filePath, tab.getCurrentMarkdown())
    tab.setModified(false)
  } catch (err) {
    alert('Could not save: ' + String(err))
  }
}

export async function saveFileAs(tm: TabManager): Promise<void> {
  const tab = tm.active()
  if (!tab) return
  try {
    const path = await SaveFileDialog(tab.filePath || 'Untitled.md')
    if (!path) return
    tab.setFilePath(path)
    await WriteFile(path, tab.getCurrentMarkdown())
    tab.setModified(false)
  } catch (err) {
    alert('Could not save: ' + String(err))
  }
}

export function insertLink(tm: TabManager): void {
  const tab = tm.active()
  if (!tab) return
  if (tab.linkController?.requestLink()) return
  const prev = (tab.editor.getAttributes('link').href as string | undefined) || ''
  const url = prompt('URL:', prev)
  if (url === null) return
  if (url === '') {
    tab.editor.chain().focus().unsetLink().run()
  } else {
    tab.editor.chain().focus().setLink({ href: url }).run()
  }
}

export function insertImage(tm: TabManager): void {
  const tab = tm.active()
  if (!tab) return
  const url = prompt('Image URL:')
  if (!url) return
  tab.editor.chain().focus().setImage({ src: url }).run()
}
