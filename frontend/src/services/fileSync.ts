import type { TabManager } from '../app/tabManager'
import type { DiskStat, Tab } from '../app/tab'
import { ReadFile, StatFile } from '../app/ipc'

// How often the active file is polled for changes while the window is focused.
// One StatFile IPC per tick (no read unless the stat moved) — cheap enough to
// catch an agent editing the file you're looking at without a filesystem watcher.
const POLL_MS = 1500

// Guards against overlapping async re-checks of the same tab (the poll, focus,
// and activation can all fire close together).
const inFlight = new Set<string>()

function statsEqual(a: DiskStat | null, b: DiskStat): boolean {
  return a !== null && a.modTimeMs === b.modTimeMs && a.size === b.size
}

/**
 * Re-check one file-backed tab against disk. Stat-gated: a quiescent file costs a
 * single StatFile and no read. When the file actually changed, a clean tab
 * reloads in place and a dirty tab raises a conflict flag — never clobbering
 * unsaved edits. Our own saves self-suppress (disk bytes == the recorded
 * baseline). Re-validates after every await since the tab may close/save/reload
 * meanwhile.
 */
export async function recheckTab(tab: Tab): Promise<void> {
  const path = tab.filePath
  // Skip deferred (not-yet-materialized) tabs: their baseline isn't established
  // and their real content is still parked in `pendingContent`. Reloading one
  // now would be silently undone when it later materializes that stale content
  // (tabManager.materialize). They're re-checked once activation materializes
  // them (setActive → materialize → the activation re-check below).
  if (!path || tab.pendingContent !== null || inFlight.has(tab.id)) return
  inFlight.add(tab.id)
  try {
    let stat: DiskStat
    try {
      stat = await StatFile(path)
    } catch {
      // Missing/unreadable — keep the buffer untouched. (Deleted-on-disk handling
      // is deferred; see external-file-changes-plan.md.)
      return
    }
    if (tab.filePath !== path) return
    if (statsEqual(tab.diskStat, stat)) return // unchanged since last check

    let content: string
    try {
      content = await ReadFile(path)
    } catch (err) {
      console.error('[fileSync] could not read', path, err)
      return
    }
    if (tab.filePath !== path) return

    if (content === tab.diskContent) {
      tab.diskStat = stat // touch / our own save / reverted edit — nothing to do
      return
    }
    if (tab.isAtSavedState()) {
      tab.reloadFromDisk(content) // clean → silently reload in place
    } else {
      tab.flagExternalChange(content) // dirty → surface the conflict banner
    }
    // Record the disk version we acted on so the same bytes don't re-fire; a
    // further external write moves the stat and re-checks against diskContent.
    tab.diskStat = stat
  } finally {
    inFlight.delete(tab.id)
  }
}

/** Re-check every file-backed tab in the window (focus / visibility regain). */
export function recheckAllTabs(tm: TabManager): void {
  for (const tab of tm.tabs) {
    if (tab.filePath) void recheckTab(tab)
  }
}

/**
 * Start watching this window's open files for external changes. Returns a
 * disposer. Strategy (see ../../../md-pro/docs/external-file-changes-plan.md): no
 * filesystem watcher — re-check everything on window focus / visibility and the
 * moment a tab becomes active (covers background tabs cheaply, multi-window for
 * free), plus a light poll of ONLY the active file while the window is focused
 * (covers the file you're looking at, live, within POLL_MS).
 */
export function startFileSync(tm: TabManager): () => void {
  const onFocus = (): void => recheckAllTabs(tm)
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') recheckAllTabs(tm)
  }
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisible)

  // Re-check a tab the instant it becomes active — covers switching to a tab
  // whose file changed while the window stayed focused (so no focus event fired).
  let lastActiveId = tm.activeId
  const offChange = tm.onChange(() => {
    if (tm.activeId === lastActiveId) return
    lastActiveId = tm.activeId
    const active = tm.active()
    if (active?.filePath) void recheckTab(active)
  })

  const timer = setInterval(() => {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    const active = tm.active()
    if (active?.filePath) void recheckTab(active)
  }, POLL_MS)

  return () => {
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisible)
    offChange()
    clearInterval(timer)
  }
}
