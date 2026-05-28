import { previewFileHead } from '../../services/files'

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

const MAX_BODY_LINES = 4

export function createHoverPreview(config: Config): HoverPreview {
  const delayMs = config.delayMs ?? 700
  const popover = document.createElement('div')
  popover.className = 'tree-hover-preview'
  popover.style.display = 'none'
  document.body.appendChild(popover)

  let timer: ReturnType<typeof setTimeout> | null = null
  // Bumped on every cancel/show so a slow file read that resolves after the
  // user has moved on can detect it's stale and bail.
  let token = 0
  let currentPath: string | null = null

  function hide(): void {
    popover.style.display = 'none'
  }

  function setContent(title: string, body: string): void {
    popover.replaceChildren()
    const titleEl = document.createElement('div')
    titleEl.className = 'tree-hover-preview-title'
    titleEl.textContent = title
    popover.appendChild(titleEl)
    const bodyEl = document.createElement('div')
    if (body) {
      bodyEl.className = 'tree-hover-preview-body'
      bodyEl.textContent = body
    } else {
      bodyEl.className = 'tree-hover-preview-empty'
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

  async function show(path: string): Promise<void> {
    const myToken = ++token
    const raw = await previewFileHead(path)
    if (myToken !== token) return // user moved on while we were reading
    const rect = config.resolveAnchor(path)
    if (!rect) {
      hide()
      return
    }
    const { title, body } = extractPreview(raw, path)
    setContent(title, body)
    position(rect)
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    token++ // invalidate any in-flight show
    currentPath = null
    hide()
  }

  function schedule(path: string): void {
    if (path === currentPath) return
    cancel()
    currentPath = path
    timer = setTimeout(() => {
      timer = null
      void show(path)
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
function extractPreview(raw: string, path: string): { title: string; body: string } {
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
