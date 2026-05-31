import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { getRenderMode, nodesFromMarkdown } from '../mode'
import { hybridNodesFromMarkdown } from '../serialize/hybridLoad'

// Paste markdown as markdown. Markdown is the source-of-truth, so pasted text is
// interpreted as markdown and rendered for the current mode — rather than landing
// as literal characters, which is what ProseMirror does by default (a source
// block is `code: true`, so paste returns the raw text verbatim; in WYSIWYG the
// clipboard's HTML flavour wins and shows the literal `#`/`**`).
//
// We take over `handlePaste`, read the clipboard's plain text, parse it into the
// nodes for the active render mode (source blocks for top-level paragraphs/
// headings in hybrid; plain TipTap nodes in WYSIWYG), and replace the selection.

// Elements that mean the clipboard HTML carries real formatting the plain text
// can't reconstruct (links, emphasis, lists, tables, headings, …). Their
// presence makes us defer to ProseMirror's normal HTML paste so rich content
// from a web page or word processor keeps its marks.
//
// div / span / p / br / pre / code are deliberately absent: code editors,
// terminals, textareas and chat code-fences wrap raw markdown in exactly those,
// and there the *plain text* is the real payload — so we still read it as
// markdown rather than the styled-but-structureless HTML mirror beside it.
const RICH_HTML_SELECTOR =
  'a,strong,b,em,i,u,s,strike,del,ins,mark,sub,sup,h1,h2,h3,h4,h5,h6,' +
  'ul,ol,li,table,thead,tbody,tr,td,th,blockquote,img,figure,picture,hr'

// True when the clipboard HTML is just a styled mirror of its plain text (a code
// editor / terminal / textarea copy) rather than a structured rich document —
// i.e. nothing is lost by interpreting the plain text as markdown. Absent or
// unparseable HTML counts as a mirror.
function htmlIsPlainTextMirror(html: string): boolean {
  if (!html.trim()) return true
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return !doc.body?.querySelector(RICH_HTML_SELECTOR)
}

// Replace the selection with `text` parsed as markdown, honouring the render
// mode. Returns false (so the caller can fall through to the default paste) when
// the text yields no block. Inline content merges into the current block;
// multi-block content splits it (see the openness logic below). Exported for the
// test harness.
export function replaceSelectionWithMarkdown(
  view: EditorView,
  editor: Editor,
  text: string,
): boolean {
  const hybrid = getRenderMode(editor) === 'hybrid'
  const nodes = hybrid ? hybridNodesFromMarkdown(editor, text) : nodesFromMarkdown(editor, text)
  if (!nodes.length) return false
  // In hybrid, a single source block is just one block of raw markdown. Let the
  // default paste drop it in verbatim (the block is `code: true`, so ProseMirror
  // inserts the literal text and the live decorations render it) — that keeps
  // exact spacing the markdown round-trip would otherwise normalise away. Only
  // multi-block or structural content (lists, tables, code, …) needs the slice.
  if (hybrid && nodes.length === 1 && nodes[0].type.name === 'sourceBlock') return false
  try {
    // Open a boundary only when its edge block is a mergeable text block, so its
    // inline content flows into the block at the caret (the leading block joins
    // the text before the caret, the trailing block joins the text after).
    // Lists/tables/code/quotes stay closed so they drop in as whole blocks
    // instead of dissolving their first/last item into the surrounding text —
    // which is what `Slice.maxOpen` would wrongly do.
    const openStart = isMergeableTextBlock(nodes[0]) ? 1 : 0
    const openEnd = isMergeableTextBlock(nodes[nodes.length - 1]) ? 1 : 0
    const slice = new Slice(Fragment.fromArray(nodes), openStart, openEnd)
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
    return true
  } catch {
    return false
  }
}

// The top-level text blocks whose inline content should merge into the caret's
// block on paste (vs. structural blocks — lists, tables, code, quotes — that
// drop in whole).
function isMergeableTextBlock(node: PMNode): boolean {
  const name = node.type.name
  return name === 'paragraph' || name === 'heading' || name === 'sourceBlock'
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste(view, event) {
            const cd = event.clipboardData
            if (!cd) return false
            const text = cd.getData('text/plain')
            if (!text.trim()) return false // nothing pasteable as text (e.g. an image)
            // Genuine rich HTML keeps its formatting via the default paste; only
            // re-read the clipboard as markdown when the HTML is a plain mirror.
            if (!htmlIsPlainTextMirror(cd.getData('text/html'))) return false

            // Only top-level paragraphs/headings/source blocks. Nested text (list
            // items, table cells, blockquotes) and fenced code blocks keep the
            // default paste so their structure / literal semantics are preserved.
            const { $from } = view.state.selection
            if ($from.depth !== 1 || $from.parent.type.name === 'codeBlock') return false

            return replaceSelectionWithMarkdown(view, editor, text)
          },
        },
      }),
    ]
  },
})
