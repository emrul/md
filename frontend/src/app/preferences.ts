import {
  Get as GetPrefs,
  Set as SetPrefs,
  TrackRecentRoot as $TrackRecentRoot,
  TogglePinnedRoot as $TogglePinnedRoot,
  SetFeatureSetting as $SetFeatureSetting,
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
  /**
   * Generic, add-only string→string bag for optional features (e.g. the pro
   * overlay). Core never reads specific keys — it just round-trips the map — so
   * no feature names leak into OSS. Access via getFeatureSetting/setFeatureSetting.
   */
  featureSettings: Record<string, string>
}

const defaults: Preferences = {
  useTabs: true,
  showDotFolders: false,
  editorMode: 'hybrid',
  pinnedRoots: [],
  recentRoots: [],
  featureSettings: {},
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
    featureSettings: toStringMap(p.featureSettings),
  }
}

// The generated model types map values as `string | undefined`; normalize to a
// plain Record<string,string> so callers get defined values.
function toStringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') out[k] = val
    }
  }
  return out
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
    // Round-trip the generic feature bag so an unrelated preference save never
    // wipes it (it's not a typed field the caller of updatePreference touches).
    featureSettings: cached.featureSettings,
  })
  void SetPrefs(onWire).catch((err) => {
    console.warn('[prefs] failed to persist', key, err)
  })
}

/**
 * Read a single key from the generic feature-settings bag (synchronous, from the
 * cache). Returns '' when absent. Exposed via the @markdownmd barrel so the
 * commercial overlay can persist small per-feature settings without a dedicated
 * typed preference field.
 */
export function getFeatureSetting(key: string): string {
  return cached.featureSettings[key] ?? ''
}

/**
 * Write one key into the feature-settings bag and persist. Goes through the Go
 * SetFeatureSetting (read-modify-write on disk) so it merges a single key rather
 * than re-serializing the whole Preferences struct; the returned value refreshes
 * the cache. Optimistically updates the cache first so a synchronous
 * getFeatureSetting right after sees the new value.
 */
export async function setFeatureSetting(key: string, value: string): Promise<void> {
  cached = { ...cached, featureSettings: { ...cached.featureSettings, [key]: value } }
  try {
    const updated = await $SetFeatureSetting(key, value)
    cached = fromWire(updated)
  } catch (err) {
    console.warn('[prefs] setFeatureSetting failed', key, err)
  }
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
