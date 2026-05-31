import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Browser } from '@wailsio/runtime'

// [text](url) — used to recover the URL when the click lands in a source block,
// where the link is raw text rather than a ProseMirror mark.
const SB_LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/g

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

// Open absolute web/mail/tel links in the system browser on ⌘/Ctrl-click.
// Relative/anchor links are left alone (in-app navigation isn't wired yet).
export const LinkOpen = Extension.create({
  name: 'linkOpen',

  addProseMirrorPlugins() {
    const ABS = /^(https?|mailto|tel):/i
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            // ⌘/Ctrl-click opens absolute links in the system browser. We hook
            // the real DOM click (not PM's handleClick) for two reasons: a
            // WYSIWYG link renders as a real <a>, so we read its href straight
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
              if (!href || !ABS.test(href)) return false
              event.preventDefault()
              void Browser.OpenURL(href).catch(() => {})
              return true
            },
          },
        },
      }),
    ]
  },
})
