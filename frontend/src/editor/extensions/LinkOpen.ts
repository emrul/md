import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Browser } from '@wailsio/runtime'
import { commands } from '../../commands/registry'
import { resolveLink } from '../../services/workspace'

// [text](url) — used to recover the URL when the click lands in a source block,
// where the link is raw text rather than a ProseMirror mark.
const SB_LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/g

// Absolute web/mail/tel links → system browser. Everything else is treated as a
// candidate local target.
const ABS = /^(https?|mailto|tel):/i
const MD_EXT = /\.(md|markdown|mdx)$/i

// Cheap, synchronous pre-filter (safe on every mouse-move): does this href look
// like a *local* markdown link? Absolute URLs are excluded; the path portion
// (sans #fragment / ?query, lightly decoded) must end in a markdown extension.
// Actual resolution + existence is confirmed Go-side via resolveLink.
export function looksLocalMd(href: string | null | undefined): boolean {
  if (!href || ABS.test(href)) return false
  let p = href.split(/[#?]/, 1)[0]
  try {
    p = decodeURIComponent(p)
  } catch {
    /* keep the raw path if it isn't valid percent-encoding */
  }
  return MD_EXT.test(p)
}

// Resolve the link target at a document position, covering both worlds: a
// WYSIWYG `link` mark (tables/lists) and a source block's literal [text](url).
export function linkHrefAt(state: EditorState, pos: number): string | null {
  const { doc, schema } = state
  const $pos = doc.resolve(pos)

  const linkType = schema.marks.link
  if (linkType) {
    const fromMarks = (
      node: { marks: readonly { type: unknown; attrs: { href?: string } }[] } | null | undefined,
    ): string | null => {
      const mark = node?.marks.find((m) => m.type === linkType)
      return (mark?.attrs.href as string | undefined) ?? null
    }
    const href = fromMarks($pos.nodeAfter) ?? fromMarks($pos.nodeBefore)
    if (href) return href
  }

  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'sourceBlock') {
      const offset = pos - $pos.start(d)
      SB_LINK_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = SB_LINK_RE.exec(node.textContent)) !== null) {
        if (offset >= m.index && offset <= m.index + m[0].length) return m[2]
      }
      break
    }
  }
  return null
}

// Resolve a local markdown link and open it as a tab. openPath dedupes — it
// switches to the file's tab if already open, else opens a new one.
async function openLocalLink(fromFile: string, href: string): Promise<void> {
  try {
    const r = await resolveLink(fromFile, href)
    if (r.exists && r.isMarkdown) commands.execute('files.openPath', { path: r.path })
  } catch {
    /* resolution failed — leave the link as a no-op rather than erroring */
  }
}

export interface LinkOpenOptions {
  /** The receiving document's path (or null for Untitled) — base for relative links. */
  getSourcePath: () => string | null
}

// ⌘/Ctrl-click opens links: absolute web/mail/tel in the system browser, local
// markdown files as a tab in-app.
export const LinkOpen = Extension.create<LinkOpenOptions>({
  name: 'linkOpen',

  addOptions() {
    return { getSourcePath: () => null }
  },

  addProseMirrorPlugins() {
    const getSourcePath = this.options.getSourcePath
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            // We hook the real DOM click (not PM's handleClick) for two reasons:
            // a WYSIWYG link renders as a real <a>, so we read its href straight
            // off the event target; and we preventDefault before WebKit follows
            // the anchor itself. That native anchor handling is why WYSIWYG links
            // weren't opening while hybrid source-block links (plain text, no
            // <a>) were — PM's mousedown/up-derived handleClick never fired
            // cleanly for the anchor.
            click(view, event) {
              if (!(event.metaKey || event.ctrlKey)) return false
              const anchor = (event.target as HTMLElement | null)?.closest('a[href]')
              let href = anchor?.getAttribute('href') ?? null
              if (!href) {
                // Source-block links are literal text — resolve via the position.
                const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
                if (at) href = linkHrefAt(view.state, at.pos)
              }
              if (!href) return false
              if (ABS.test(href)) {
                event.preventDefault()
                void Browser.OpenURL(href).catch(() => {})
                return true
              }
              if (looksLocalMd(href)) {
                event.preventDefault()
                void openLocalLink(getSourcePath() ?? '', href)
                return true
              }
              return false
            },
          },
        },
      }),
    ]
  },
})
