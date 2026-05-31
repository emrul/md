// Public API consumed by the commercial overlay (md-pro) through the
// `@markdownmd` vite alias. Keep this surface stable — an external build imports
// from here. See ../md-pro/docs/pro-features.md.

export { boot } from './app/boot'
export { bootEditorWindow } from './app/bootEditor'
export { registerFeature, features } from './app/features'
export type { FeatureModule, FeatureContext } from './app/features'

export { commands } from './commands'
export type { Command } from './commands/registry'

export type { TabManager } from './app/tabManager'
export type { ExplorerState } from './app/explorerState'
export type { Tab } from './app/tab'
export type { ViewController } from './app/viewMode'
export type { GutterRail, RailItemHandle, RailItemSpec } from './ui/gutterRail'

// Generic feature-settings bag accessors (string→string), for optional features
// to persist small settings without a dedicated typed preference field.
export { getFeatureSetting, setFeatureSetting } from './app/preferences'

// Safe markdown→HTML render (parser runs with html:false; raw HTML escaped).
export { renderMarkdownToHtml } from './editor/serialize/markdown'

// Canonicalize a markdown string via the editor's parser+serializer round-trip,
// so a diff of two snapshots isn't swamped by serializer-normalization noise.
export { normalizeMarkdown } from './editor/mode'
