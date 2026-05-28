// Public API consumed by the commercial overlay (md-pro) through the
// `@markdownmd` vite alias. Keep this surface stable — an external build imports
// from here. See docs/pro-features.md.

export { boot } from './app/boot'
export { bootEditorWindow } from './app/bootEditor'
export { registerFeature, features } from './app/features'
export type { FeatureModule, FeatureContext } from './app/features'

export { commands } from './commands'
export type { Command } from './commands/registry'

export type { TabManager } from './app/tabManager'
export type { ExplorerState } from './app/explorerState'
export type { Tab } from './app/tab'
