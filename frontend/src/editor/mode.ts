import type { Editor } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'

// The editor's *rendering* mode. (The user-facing third mode, "source", is a
// CodeMirror overlay owned by the ViewController, not a schema concern.) Both
// modes share one schema; the mode is *derived from the document* rather than a
// separate flag — top-level source blocks mean hybrid, top-level paragraphs/
// headings mean wysiwyg. Deriving it keeps undo coherent: a switch is just a
// normal (undoable) transform, and undo/redo move content and mode together
// instead of letting a stored flag drift out of sync with the doc.
export type RenderMode = 'wysiwyg' | 'hybrid'

export function getRenderMode(editor: Editor): RenderMode {
  const doc = editor.state.doc
  for (let i = 0; i < doc.childCount; i++) {
    const name = doc.child(i).type.name
    if (name === 'sourceBlock') return 'hybrid'
    if (name === 'paragraph' || name === 'heading') return 'wysiwyg'
  }
  return 'hybrid' // no top-level text block (e.g. table-only) → app default
}

interface MarkdownIO {
  parser: { parse(md: string): string } // returns HTML
  serializer: { serialize(node: PMNode): string }
}
function markdownIO(editor: Editor): MarkdownIO {
  return editor.storage.markdown as unknown as MarkdownIO
}

// markdown text → ProseMirror block nodes (markdown → HTML → PM via the schema).
function nodesFromMarkdown(editor: Editor, raw: string): PMNode[] {
  const html = markdownIO(editor).parser.parse(raw)
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  const doc = PMDOMParser.fromSchema(editor.schema).parse(tmp)
  const nodes: PMNode[] = []
  doc.content.forEach((n) => nodes.push(n))
  return nodes
}

// A single block node → its markdown (whole-doc serialization is correct;
// per-node serialization isn't, so wrap the node in a throwaway doc).
function blockToMarkdown(editor: Editor, node: PMNode): string {
  const doc = editor.schema.nodes.doc.create(null, [node])
  return markdownIO(editor).serializer.serialize(doc).replace(/\n+$/, '')
}

// Round-trip a markdown string through the editor's parser + serializer to get
// its canonical form (markdown → HTML → PM doc → markdown). Two strings that are
// semantically identical but spelled differently (e.g. `_x_` vs `*x*`, varying
// list markers, trailing whitespace, line endings) normalize to the same bytes.
// Exposed via the @markdownmd barrel so a diff can compare two snapshots without
// drowning in serializer-normalization noise. Does NOT touch the live editor.
export function normalizeMarkdown(editor: Editor, raw: string): string {
  if (!raw.trim()) return ''
  const nodes = nodesFromMarkdown(editor, raw)
  if (!nodes.length) return ''
  const doc = editor.schema.nodes.doc.create(null, nodes)
  return markdownIO(editor).serializer.serialize(doc).replace(/\n+$/, '')
}

function applyReplace(editor: Editor, content: PMNode[], addToHistory: boolean): void {
  const { state, view } = editor
  const from = state.selection.from
  const tr = state.tr.replaceWith(0, state.doc.content.size, content)
  if (addToHistory) {
    // Seal the previous history event so the switch is its own undo step and
    // never merges with adjacent typing.
    closeHistory(tr)
  } else {
    tr.setMeta('addToHistory', false)
  }
  const pos = Math.min(from, tr.doc.content.size)
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
  view.dispatch(tr)
}

// hybrid → wysiwyg: top-level source blocks become paragraphs/headings (with
// real marks). Other top-level nodes (tables/lists/code) are left as-is.
export function convertToWysiwyg(editor: Editor, addToHistory = true): void {
  const { schema, doc } = editor.state
  const sbType = schema.nodes.sourceBlock
  if (!sbType) return
  const content: PMNode[] = []
  let changed = false
  doc.forEach((node) => {
    if (node.type === sbType) {
      changed = true
      const raw = node.textContent
      const parsed = raw.trim() ? nodesFromMarkdown(editor, raw) : []
      if (parsed.length) parsed.forEach((n) => content.push(n))
      else content.push(schema.nodes.paragraph.create())
    } else {
      content.push(node)
    }
  })
  if (changed) applyReplace(editor, content, addToHistory)
}

// wysiwyg → hybrid: top-level paragraphs/headings become source blocks holding
// their raw markdown. Other top-level nodes are left as-is.
export function convertToHybrid(editor: Editor, addToHistory = true): void {
  const { schema, doc } = editor.state
  const sbType = schema.nodes.sourceBlock
  if (!sbType) return
  const content: PMNode[] = []
  let changed = false
  doc.forEach((node) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      changed = true
      const md = blockToMarkdown(editor, node)
      content.push(md ? sbType.create(null, schema.text(md)) : sbType.create())
    } else {
      content.push(node)
    }
  })
  if (changed) applyReplace(editor, content, addToHistory)
}

// Switch the active document's render mode in place. Undoable as a single step.
export function switchRenderMode(editor: Editor, mode: RenderMode): void {
  if (getRenderMode(editor) === mode) return
  if (mode === 'wysiwyg') convertToWysiwyg(editor)
  else convertToHybrid(editor)
}
