import { previewFileHead } from '../services/files'
import './filePreviewPopover.css'

export interface PreviewContent {
  title: string
  body: string
}

/**
 * A small popover that previews a markdown file's head (title + first lines)
 * after a hover dwell. Shared by the explorer's row hover preview and the
 * in-editor markdown-link hover preview. The two differ only in how they key /
 * load / anchor the preview, all supplied per-schedule:
 *
 *  - key:     dedupes rapid re-hovers of the same target (no dwell restart).
 *  - load:    async — returns the content to show, or null to skip silently
 *             (e.g. a link target that's missing or not markdown). This runs
 *             only after the dwell, so per-hover IPC stays off the mouse-move
 *             path.
 *  - getRect: the anchor rect, re-evaluated when the preview actually shows.
 */
export interface FilePreviewPopover {
  schedule(
    key: string,
    load: () => Promise<PreviewContent | null>,
    getRect: () => DOMRect | null,
  ): void
  /** Clear any pending timer and hide the popover. */
  cancel(): void
  dispose(): void
}

const MAX_BODY_LINES = 4

/** Read a file's head and reduce it to a preview (title + first lines). */
export async function loadFilePreview(path: string): Promise<PreviewContent> {
  const raw = await previewFileHead(path)
  return extractPreview(raw, path)
}

export function createFilePreviewPopover(opts: { delayMs?: number } = {}): FilePreviewPopover {
  const delayMs = opts.delayMs ?? 700
  const popover = document.createElement('div')
  popover.className = 'file-preview-popover'
  popover.style.display = 'none'
  document.body.appendChild(popover)

  let timer: ReturnType<typeof setTimeout> | null = null
  // Bumped on every cancel/show so a slow load that resolves after the user has
  // moved on can detect it's stale and bail.
  let token = 0
  let currentKey: string | null = null

  function hide(): void {
    popover.style.display = 'none'
  }

  function setContent(title: string, body: string): void {
    popover.replaceChildren()
    const titleEl = document.createElement('div')
    titleEl.className = 'file-preview-popover-title'
    titleEl.textContent = title
    popover.appendChild(titleEl)
    const bodyEl = document.createElement('div')
    if (body) {
      bodyEl.className = 'file-preview-popover-body'
      bodyEl.textContent = body
    } else {
      bodyEl.className = 'file-preview-popover-empty'
      bodyEl.textContent = 'Empty file'
    }
    popover.appendChild(bodyEl)
  }

  function position(rect: DOMRect): void {
    const margin = 8
    // Measure while hidden from view to avoid a one-frame flash at (0,0).
    popover.style.visibility = 'hidden'
    popover.style.display = 'block'
    const w = popover.offsetWidth
    const h = popover.offsetHeight

    let left = rect.right + margin
    if (left + w > window.innerWidth - margin) {
      left = Math.max(margin, rect.left - w - margin)
    }
    let top = rect.top
    if (top + h > window.innerHeight - margin) {
      top = window.innerHeight - h - margin
    }
    if (top < margin) top = margin

    popover.style.left = `${Math.round(left)}px`
    popover.style.top = `${Math.round(top)}px`
    popover.style.visibility = 'visible'
  }

  async function show(
    load: () => Promise<PreviewContent | null>,
    getRect: () => DOMRect | null,
  ): Promise<void> {
    const myToken = ++token
    let content: PreviewContent | null
    try {
      content = await load()
    } catch {
      return
    }
    if (myToken !== token) return // user moved on while we were loading
    if (!content) {
      hide()
      return
    }
    const rect = getRect()
    if (!rect) {
      hide()
      return
    }
    setContent(content.title, content.body)
    position(rect)
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    token++ // invalidate any in-flight show
    currentKey = null
    hide()
  }

  function schedule(
    key: string,
    load: () => Promise<PreviewContent | null>,
    getRect: () => DOMRect | null,
  ): void {
    if (key === currentKey) return
    cancel()
    currentKey = key
    timer = setTimeout(() => {
      timer = null
      void show(load, getRect)
    }, delayMs)
  }

  return {
    schedule,
    cancel,
    dispose(): void {
      cancel()
      popover.remove()
    },
  }
}

/**
 * Pull a heading + first few content lines out of a markdown head. Skips a
 * leading YAML frontmatter block and uses the first ATX heading as the title,
 * falling back to the filename. Light inline-marker stripping keeps the body
 * readable without pulling in a real markdown parser.
 */
function extractPreview(raw: string, path: string): PreviewContent {
  let lines = raw.split(/\r?\n/)

  let start = 0
  while (start < lines.length && lines[start].trim() === '') start++
  if (start < lines.length && lines[start].trim() === '---') {
    let end = start + 1
    while (end < lines.length && lines[end].trim() !== '---') end++
    lines = end < lines.length ? lines.slice(end + 1) : lines.slice(start + 1)
  } else {
    lines = lines.slice(start)
  }

  let title = ''
  const bodyLines: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (/^([-*_])\1{2,}$/.test(t)) continue // horizontal rule / stray delimiter
    const heading = /^#{1,6}\s+(.*\S)\s*$/.exec(t)
    if (!title && heading) {
      title = heading[1].trim()
      continue
    }
    bodyLines.push(cleanInline(t))
    if (bodyLines.length >= MAX_BODY_LINES) break
  }

  if (!title) title = stripExt(baseName(path))
  return { title, body: bodyLines.join('\n') }
}

function cleanInline(s: string): string {
  return s
    .replace(/^#{1,6}\s+/, '') // sub-heading hashes
    .replace(/^>\s?/, '') // blockquote marker
    .replace(/^[-*+]\s+/, '• ') // bullet → •
    .replace(/^\d+\.\s+/, '') // ordered-list number
    .replace(/`+/g, '') // code ticks
    .replace(/\*+/g, '') // bold/italic asterisks
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) / ![alt](url) → text/alt
}

function baseName(p: string): string {
  const parts = p.split(/[/\\]+/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function stripExt(name: string): string {
  return name.replace(/\.(md|mdx|markdown)$/i, '')
}
