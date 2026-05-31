// Per-window state for the file explorer. Lives in app/ (not ui/) so commands
// can mutate it and a future persistence layer can subscribe without reaching
// into UI modules. See ../md-pro/docs/architecture.md ("State location rules").

type Listener = () => void

export interface ExplorerStateData {
  overlayOpen: boolean
  overlayWidth: number // px
  pinnedRoot: string | null
  selectedPath: string | null
  expandedPaths: Set<string>
}

const MIN_WIDTH = 200
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 280

export class ExplorerState {
  private data: ExplorerStateData = {
    overlayOpen: false,
    overlayWidth: DEFAULT_WIDTH,
    pinnedRoot: null,
    selectedPath: null,
    expandedPaths: new Set(),
  }
  // The contextual root computed for the currently-active tab. Not part of
  // ExplorerStateData (not persisted, not user-mutable directly) — it's a
  // read-only signal used by setPinIntent to drop no-op pins.
  private _contextualRoot: string = ''
  private listeners = new Set<Listener>()

  get overlayOpen(): boolean {
    return this.data.overlayOpen
  }
  get overlayWidth(): number {
    return this.data.overlayWidth
  }
  get pinnedRoot(): string | null {
    return this.data.pinnedRoot
  }
  get selectedPath(): string | null {
    return this.data.selectedPath
  }
  get expandedPaths(): ReadonlySet<string> {
    return this.data.expandedPaths
  }

  /** Snapshot — useful for the future persistence layer. */
  snapshot(): ExplorerStateData {
    return {
      ...this.data,
      expandedPaths: new Set(this.data.expandedPaths),
    }
  }

  setOverlayOpen(open: boolean): void {
    if (this.data.overlayOpen === open) return
    this.data.overlayOpen = open
    this.notify()
  }

  toggleOverlay(): void {
    this.setOverlayOpen(!this.data.overlayOpen)
  }

  setOverlayWidth(width: number): void {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))
    if (this.data.overlayWidth === clamped) return
    this.data.overlayWidth = clamped
    this.notify()
  }

  setPinnedRoot(path: string | null): void {
    if (this.data.pinnedRoot === path) return
    this.data.pinnedRoot = path
    this.notify()
  }

  /** Read-only contextual root snapshot; set by the explorer mount whenever
   * it resolves a new contextual root. */
  get contextualRoot(): string {
    return this._contextualRoot
  }

  setContextualRoot(path: string): void {
    this._contextualRoot = path
    // No notify: contextual changes happen DURING applyEffectiveRoot, which
    // is itself a response to a state change. Re-notifying would loop.
  }

  /**
   * Set the pin to `target` UNLESS `target` would equal the current
   * contextual root — in which case clear the pin instead. This guarantees
   * the pin (and the Reset button) is only ever active when it actually
   * overrides the contextual root, so Reset is never a no-op.
   */
  setPinIntent(target: string): void {
    if (target === this._contextualRoot) {
      this.setPinnedRoot(null)
    } else {
      this.setPinnedRoot(target)
    }
  }

  setSelected(path: string | null): void {
    if (this.data.selectedPath === path) return
    this.data.selectedPath = path
    this.notify()
  }

  expand(path: string): void {
    if (this.data.expandedPaths.has(path)) return
    this.data.expandedPaths.add(path)
    this.notify()
  }

  collapse(path: string): void {
    if (!this.data.expandedPaths.has(path)) return
    this.data.expandedPaths.delete(path)
    this.notify()
  }

  /**
   * Rewrite any expandedPaths entry, the selectedPath, and the pinnedRoot
   * that points at `oldPath` or a descendant of it, replacing the matched
   * prefix with `newPath`. Used after a rename so subsequent reads don't
   * walk to the dead path.
   *
   * Handles both POSIX (`/`) and Windows (`\`) separators.
   */
  rewritePath(oldPath: string, newPath: string): void {
    if (!oldPath || oldPath === newPath) return
    const remap = (p: string | null): string | null => {
      if (!p) return p
      if (p === oldPath) return newPath
      if (p.startsWith(oldPath + '/') || p.startsWith(oldPath + '\\')) {
        return newPath + p.slice(oldPath.length)
      }
      return p
    }

    let changed = false
    const nextExpanded = new Set<string>()
    for (const p of this.data.expandedPaths) {
      const r = remap(p) as string
      if (r !== p) changed = true
      nextExpanded.add(r)
    }
    this.data.expandedPaths = nextExpanded

    const sel = remap(this.data.selectedPath)
    if (sel !== this.data.selectedPath) {
      this.data.selectedPath = sel
      changed = true
    }

    const pin = remap(this.data.pinnedRoot)
    if (pin !== this.data.pinnedRoot) {
      this.data.pinnedRoot = pin
      changed = true
    }

    if (changed) this.notify()
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }
}
