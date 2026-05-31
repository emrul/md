import { createFilePreviewPopover, loadFilePreview } from '../filePreviewPopover'

export interface HoverPreview {
  /** Start the hover-delay timer for path. No-op if already pending/shown for it. */
  schedule: (path: string) => void
  /** Clear any pending timer and hide the popover. */
  cancel: () => void
  dispose: () => void
}

interface Config {
  /** Resolve the current on-screen rect of the row for path, or null if gone. */
  resolveAnchor: (path: string) => DOMRect | null
  /** Hover dwell before the preview appears. */
  delayMs?: number
}

/**
 * Explorer row hover preview — a thin adapter over the shared file-preview
 * popover. The explorer anchors by path (rows are keyed by path); the shared
 * popover re-resolves the rect at show time via resolveAnchor.
 */
export function createHoverPreview(config: Config): HoverPreview {
  const popover = createFilePreviewPopover({ delayMs: config.delayMs })
  return {
    schedule: (path: string): void =>
      popover.schedule(path, () => loadFilePreview(path), () => config.resolveAnchor(path)),
    cancel: (): void => popover.cancel(),
    dispose: (): void => popover.dispose(),
  }
}
