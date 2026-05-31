import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { nodesFromMarkdown } from '../mode'

interface MdToken {
  type: string
  level: number
  nesting: number
  map: [number, number] | null
}

interface ParserStorage {
  parser: { md: { parse(src: string, env: object): MdToken[] } }
}

// markdown text → the top-level nodes under hybrid rules: paragraphs and
// headings become *source blocks* holding their RAW markdown (kept literal,
// rendered live by decorations), while tables, lists, code, blockquotes, etc.
// stay as WYSIWYG nodes.
//
// We first parse normally (tiptap-markdown → HTML → PM), then re-tokenise the
// same source with markdown-it to get the ordered top-level block stream (each
// block's open/leaf token carries a [startLine, endLine) map). When that stream
// lines up 1:1 with the parsed blocks we swap the simple ones for source blocks
// sliced straight from the source; otherwise we keep the plain parse so an
// unusual document can never be corrupted. Pure — never touches the live editor.
//
// Shared by the load path (`setHybridMarkdown`) and the paste path
// (`MarkdownPaste`), so both turn markdown into the same hybrid shape.
export function hybridNodesFromMarkdown(editor: Editor, text: string): PMNode[] {
  const plain = nodesFromMarkdown(editor, text)
  if (!plain.length) return plain

  const md = (editor.storage.markdown as unknown as ParserStorage | undefined)?.parser?.md
  if (!md) return plain

  let tokens: MdToken[]
  try {
    tokens = md.parse(text, {})
  } catch {
    return plain
  }

  const blocks = tokens.filter((t) => t.level === 0 && t.nesting !== -1 && t.map)
  if (blocks.length !== plain.length) return plain

  const lines = text.split('\n')

  // Bail if any non-blank source line isn't covered by a top-level block. Such
  // orphan lines (link/footnote reference definitions, front matter, …) carry
  // no block token, so slicing per block would silently drop them. The plain
  // parse handles them, so keep that result instead.
  const covered = new Array<boolean>(lines.length).fill(false)
  for (const tok of blocks) {
    for (let i = tok.map![0]; i < tok.map![1]; i++) covered[i] = true
  }
  for (let i = 0; i < lines.length; i++) {
    if (!covered[i] && lines[i].trim() !== '') return plain
  }

  const { schema } = editor
  const sbType = schema.nodes.sourceBlock
  const out: PMNode[] = []
  plain.forEach((node, index) => {
    const tok = blocks[index]
    const simple = tok.type === 'paragraph_open' || tok.type === 'heading_open'
    if (simple && tok.map) {
      const raw = lines.slice(tok.map[0], tok.map[1]).join('\n').replace(/\s+$/, '')
      out.push(raw.length ? sbType.create(null, schema.text(raw)) : sbType.create())
    } else {
      out.push(node)
    }
  })
  return out
}

// Hybrid load: replace the whole document with `text`, routing top-level
// paragraphs/headings into source blocks. `setMarkdown` calls this when the mode
// is hybrid (`editor/serialize/markdown.ts`).
export function setHybridMarkdown(editor: Editor, text: string): void {
  const nodes = hybridNodesFromMarkdown(editor, text)
  if (!nodes.length) {
    editor.commands.setContent(text)
    return
  }
  editor.commands.setContent({ type: 'doc', content: nodes.map((n) => n.toJSON()) })
}
