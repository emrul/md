import {
  GetRestoreWindow as $GetRestoreWindow,
  SaveWindowContent as $SaveWindowContent,
} from '../../bindings/markdownmd/app/sessionservice.js'
import { ExplorerSession, WindowContent } from '../../bindings/markdownmd/app/models.js'
import { log } from './log'

export interface ExplorerSnapshot {
  open: boolean
  width: number
  pinnedRoot: string
}

export interface SessionContent {
  /** Absolute file paths, in tab order. File-backed tabs only. */
  tabs: string[]
  /** Path of the active tab, or '' when the active tab was an unsaved draft. */
  activeTab: string
  explorer: ExplorerSnapshot
}

/** Fetch the tabs + explorer state a restored window should load. */
export async function getRestoreWindow(id: string): Promise<SessionContent | null> {
  try {
    const r = await $GetRestoreWindow(id)
    return {
      tabs: Array.isArray(r.tabs) ? r.tabs : [],
      activeTab: r.activeTab ?? '',
      explorer: {
        open: !!r.explorer?.open,
        width: r.explorer?.width ?? 0,
        pinnedRoot: r.explorer?.pinnedRoot ?? '',
      },
    }
  } catch (err) {
    log.warn('session', `getRestoreWindow failed: ${(err as Error).message ?? String(err)}`)
    return null
  }
}

/** Persist the current tabs + explorer state for a window. Fire-and-forget. */
export async function saveWindowContent(id: string, content: SessionContent): Promise<void> {
  if (!id) return
  const wire = new WindowContent({
    tabs: content.tabs,
    activeTab: content.activeTab,
    explorer: new ExplorerSession({
      open: content.explorer.open,
      width: content.explorer.width,
      pinnedRoot: content.explorer.pinnedRoot,
    }),
  })
  try {
    await $SaveWindowContent(id, wire)
  } catch (err) {
    log.warn('session', `saveWindowContent failed: ${(err as Error).message ?? String(err)}`)
  }
}
