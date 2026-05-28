import {
  Get as GetPrefs,
  Set as SetPrefs,
} from '../../bindings/markdownmd/preferencesservice.js'
import { Preferences as PrefsModel } from '../../bindings/markdownmd/models.js'

export interface Preferences {
  useTabs: boolean
  showDotFolders: boolean
}

const defaults: Preferences = {
  useTabs: true,
  showDotFolders: false,
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
    cached = {
      useTabs: typeof p.useTabs === 'boolean' ? p.useTabs : defaults.useTabs,
      showDotFolders:
        typeof p.showDotFolders === 'boolean' ? p.showDotFolders : defaults.showDotFolders,
    }
  } catch (err) {
    console.warn('[prefs] failed to load, using defaults', err)
    cached = { ...defaults }
  }
  return cached
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
  })
  void SetPrefs(onWire).catch((err) => {
    console.warn('[prefs] failed to persist', key, err)
  })
}
