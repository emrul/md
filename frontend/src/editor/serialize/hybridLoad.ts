import type { Editor } from '@tiptap/core'

interface MdToken {
  type: string
  level: number
  nesting: number
  map: [number, number] | null
}

interface ParserStorage {
  parser: { md: { parse(src: string, env: object): MdToken[] } }
}

// Hybrid load: route top-level paragraphs and headings into source blocks that
// hold their RAW markdown (kept literal, rendered live by decorations), while
// tables, lists, code, blockquotes, etc. stay as WYSIWYG nodes.
//
// We first let tiptap-markdown parse normally, then re-tokenise the same source
// with markdown-it to get the ordered top-level block stream (each block's
// open/leaf token carries a [startLine, endLine) map). When that stream lines
// up 1:1 with the parsed doc's children we swap the simple blocks for source
// blocks sliced straight from the source; otherwise we keep the plain parse so
// an unusual document can never be corrupted on load.
export function setHybridMarkdown(editor: Editor, text: string): void {
  editor.commands.setContent(text)

  const md = (editor.storage.markdown as unknown as ParserStorage | undefined)?.parser?.md
  if (!md) return

  let tokens: MdToken[]
  try {
    tokens = md.parse(text, {})
  } catch {
    return
  }

  const blocks = tokens.filter((t) => t.level === 0 && t.nesting !== -1 && t.map)
  const doc = editor.state.doc
  if (blocks.length !== doc.childCount) return

  const lines = text.split('\n')

  // Bail if any non-blank source line isn't covered by a top-level block. Such
  // orphan lines (link/footnote reference definitions, front matter, …) carry
  // no block token, so slicing per block would silently drop them. The plain
  // tiptap-markdown parse handles them, so keep that result instead.
  const covered = new Array<boolean>(lines.length).fill(false)
  for (const tok of blocks) {
    for (let i = tok.map![0]; i < tok.map![1]; i++) covered[i] = true
  }
  for (let i = 0; i < lines.length; i++) {
    if (!covered[i] && lines[i].trim() !== '') return
  }
  const content: object[] = []
  let changed = false
  doc.forEach((node, _offset, index) => {
    const tok = blocks[index]
    const simple = tok.type === 'paragraph_open' || tok.type === 'heading_open'
    if (simple && tok.map) {
      const raw = lines.slice(tok.map[0], tok.map[1]).join('\n').replace(/\s+$/, '')
      content.push(
        raw.length
          ? { type: 'sourceBlock', content: [{ type: 'text', text: raw }] }
          : { type: 'sourceBlock' },
      )
      changed = true
    } else {
      content.push(node.toJSON())
    }
  })

  if (changed) editor.commands.setContent({ type: 'doc', content })
}
