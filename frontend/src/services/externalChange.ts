import type { Tab } from '../app/tab'

/**
 * Open-core seam for resolving an external-change conflict (file changed on disk
 * while the buffer had unsaved edits). The OSS banner offers plain Reload / Save
 * mine / Keep actions; the commercial overlay (md-pro) registers a richer
 * resolver that opens the disk-vs-working diff (reusing the Change-History
 * `DiffEngine` + the `ViewController` read-only overlay). When none is
 * registered the banner simply omits its "Compare…" affordance.
 */
export type ConflictResolver = (tab: Tab) => void

let resolver: ConflictResolver | null = null

/** Register (or clear, with null) the pro conflict resolver. Call from a feature
 * mount hook. Exposed via the `@markdownmd` barrel for md-pro. */
export function setConflictResolver(fn: ConflictResolver | null): void {
  resolver = fn
}

/** The registered resolver, or null in the free build. */
export function getConflictResolver(): ConflictResolver | null {
  return resolver
}
