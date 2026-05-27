import { Get as GetPrefs } from '../../bindings/markdownmd/preferencesservice.js'

export interface Preferences {
  useTabs: boolean
}

const defaults: Preferences = {
  useTabs: true,
}

let cached: Preferences = { ...defaults }

/**
 * Read preferences from the Go side and cache them. Call once on boot;
 * subsequent reads via `prefs()` return the cached values until the next
 * `loadPreferences()` invocation.
 */
export async function loadPreferences(): Promise<Preferences> {
  try {
    const p = await GetPrefs()
    cached = {
      useTabs: typeof p.useTabs === 'boolean' ? p.useTabs : defaults.useTabs,
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
