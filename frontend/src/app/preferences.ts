import {
  Get as GetPrefs,
  Set as SetPrefs,
  TrackRecentRoot as $TrackRecentRoot,
  TogglePinnedRoot as $TogglePinnedRoot,
} from '../../bindings/markdownmd/app/preferencesservice.js'
import { Preferences as PrefsModel } from '../../bindings/markdownmd/app/models.js'

// 'source' opens new tabs straight into the raw-markdown view (over a hybrid
// editor underneath); 'wysiwyg'/'hybrid' pick the editor's render mode.
export type EditorMode = 'wysiwyg' | 'hybrid' | 'source'

export interface Preferences {
  useTabs: boolean
  showDotFolders: boolean
  editorMode: EditorMode
  pinnedRoots: string[]
  recentRoots: string[]
}

const defaults: Preferences = {
  useTabs: true,
  showDotFolders: false,
  editorMode: 'hybrid',
  pinnedRoots: [],
  recentRoots: [],
}

let cached: Preferences = { ...defaults }

/**
 * Read preferences from the Go side and cache them. Call once on boot;
 * subsequent reads via `prefs()` return the cached values until the next
 * `loadPreferences()` invocation (or a mutator).
 */
export async function loadPreferences(): Promise<Preferences> {
  try {
    const p = await GetPrefs()
    cached = fromWire(p)
  } catch (err) {
    console.warn('[prefs] failed to load, using defaults', err)
    cached = { ...defaults }
  }
  return cached
}

function fromWire(p: PrefsModel): Preferences {
  return {
    useTabs: typeof p.useTabs === 'boolean' ? p.useTabs : defaults.useTabs,
    showDotFolders:
      typeof p.showDotFolders === 'boolean' ? p.showDotFolders : defaults.showDotFolders,
    editorMode:
      p.editorMode === 'wysiwyg' || p.editorMode === 'hybrid' || p.editorMode === 'source'
        ? p.editorMode
        : defaults.editorMode,
    pinnedRoots: Array.isArray(p.pinnedRoots) ? p.pinnedRoots : [],
    recentRoots: Array.isArray(p.recentRoots) ? p.recentRoots : [],
  }
}

/** Synchronous accessor for the cached preferences. */
export function prefs(): Preferences {
  return cached
}

/**
 * Mutate one preference and persist the full Preferences object back to Go.
 * Updates the cache synchronously so subsequent reads see the new value;
 * persistence is fire-and-forget (logged on error).
 */
export function updatePreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): void {
  cached = { ...cached, [key]: value }
  const onWire = new PrefsModel({
    useTabs: cached.useTabs,
    showDotFolders: cached.showDotFolders,
    editorMode: cached.editorMode,
    pinnedRoots: cached.pinnedRoots,
    recentRoots: cached.recentRoots,
  })
  void SetPrefs(onWire).catch((err) => {
    console.warn('[prefs] failed to persist', key, err)
  })
}

/**
 * Promote `path` to the front of the recent-roots list. Resolves with the
 * updated preferences; the cache is refreshed for any subsequent reads.
 * Pinned items are skipped (already kept around regardless of recency).
 */
export async function trackRecentRoot(path: string): Promise<Preferences> {
  try {
    const updated = await $TrackRecentRoot(path)
    cached = fromWire(updated)
  } catch (err) {
    console.warn('[prefs] trackRecentRoot failed', err)
  }
  return cached
}

/** Toggle `path` between RecentRoots and PinnedRoots, persisting via Go. */
export async function togglePinnedRoot(path: string): Promise<Preferences> {
  try {
    const updated = await $TogglePinnedRoot(path)
    cached = fromWire(updated)
  } catch (err) {
    console.warn('[prefs] togglePinnedRoot failed', err)
  }
  return cached
}
