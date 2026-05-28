import type { TabManager } from './tabManager'
import type { ExplorerState } from './explorerState'
import type { Tab } from './tab'

/**
 * Context handed to every feature hook. This is a cross-repo API surface (the
 * commercial overlay depends on it) — only ever ADD fields, never reorder or
 * remove, so existing pro features keep compiling.
 */
export interface FeatureContext {
  tm: TabManager
  explorer: ExplorerState
}

/**
 * A feature contributed by the commercial overlay (md-pro). Register it with
 * registerFeature() before boot(); bootEditor invokes the optional hooks at the
 * matching points in the boot sequence. The free build registers none of these,
 * so all hooks are no-ops in OSS.
 *
 * Gate paid features on the license inside these hooks (read it from the pro Go
 * LicenseService) — either skip registration entirely (hidden) or register and
 * upsell on execute (discoverable). See docs/pro-features.md.
 */
export interface FeatureModule {
  /** Stable unique id, e.g. "pro.ai-assist". Used for dedupe and logging. */
  id: string
  /** Register commands in the registry. Runs once, after core commands. */
  registerCommands?(ctx: FeatureContext): void
  /** Per-tab wiring (editor plugins, listeners). Runs for every tab created. */
  attachTab?(tab: Tab, ctx: FeatureContext): void
  /** Mount persistent UI (panels, status items). Runs once, after core UI. */
  mount?(ctx: FeatureContext): void
}

const registered: FeatureModule[] = []

/**
 * Register a feature module. Call before boot()/bootEditorWindow(). Idempotent
 * per id: a duplicate id is ignored with a warning, so a stray double-import
 * can't double-wire commands.
 */
export function registerFeature(mod: FeatureModule): void {
  if (registered.some((m) => m.id === mod.id)) {
    console.warn(`[features] duplicate feature ignored: ${mod.id}`)
    return
  }
  registered.push(mod)
}

/** All registered features, in registration order. Consumed by bootEditor. */
export function features(): readonly FeatureModule[] {
  return registered
}
