import type { Editor, Range } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Selection, TextSelection } from '@tiptap/pm/state'

export interface SlashItem {
  id: string
  label: string
  hint?: string
  search: string[]
  apply: (editor: Editor, range: Range) => void
}

// In hybrid mode the caret sits inside a sourceBlock, so heading items must
// toggle a literal "#{level} " prefix instead of creating a heading node.
function inSourceBlock(e: Editor): boolean {
  const { $from } = e.state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'sourceBlock') return true
  }
  return false
}
function applyHeading(e: Editor, r: Range, level: 1 | 2 | 3): void {
  if (inSourceBlock(e)) {
    e.chain().focus().deleteRange(r).toggleSourceHeading(level).run()
  } else {
    e.chain().focus().deleteRange(r).setNode('heading', { level }).run()
  }
}

type ListKind = 'bullet' | 'ordered' | 'task'

function createListNode(schema: Schema, kind: ListKind, text: string): PMNode | null {
  const paragraph = schema.nodes.paragraph?.create(
    null,
    text ? schema.text(text.replace(/\s*\n\s*/g, ' ')) : null,
  )
  if (!paragraph) return null

  if (kind === 'task') {
    const item = schema.nodes.taskItem?.create({ checked: false }, paragraph)
    if (!item) return null
    return schema.nodes.taskList?.create(null, item) ?? null
  }

  const item = schema.nodes.listItem?.create(null, paragraph)
  if (!item) return null
  if (kind === 'ordered') return schema.nodes.orderedList?.create(null, item) ?? null
  return schema.nodes.bulletList?.create(null, item) ?? null
}

function listCursorPos(doc: PMNode, listPos: number, list: PMNode, textLength: number): number {
  let cursor: number | null = null
  doc.nodesBetween(listPos, listPos + list.nodeSize, (node, pos) => {
    if (!node.isTextblock) return cursor === null
    cursor = pos + 1 + Math.min(textLength, node.content.size)
    return false
  })
  return cursor ?? listPos
}

function applyList(e: Editor, r: Range, kind: ListKind): void {
  const handled = e.commands.command(({ state, dispatch }) => {
    const $from = state.doc.resolve(r.from)
    const blockDepth =
      $from.parent.type.name === 'sourceBlock' ||
      $from.parent.type.name === 'paragraph' ||
      $from.parent.type.name === 'heading'
        ? $from.depth
        : -1

    if (blockDepth !== 1 || state.doc.resolve(r.to).depth !== blockDepth) return false

    const block = $from.node(blockDepth)
    const blockStart = $from.start(blockDepth)
    const blockEnd = $from.end(blockDepth)
    const itemText = (
      state.doc.textBetween(blockStart, r.from) + state.doc.textBetween(r.to, blockEnd)
    ).trim()
    const list = createListNode(state.schema, kind, itemText)
    if (!list) return false
    if (!dispatch) return true

    const blockPos = $from.before(blockDepth)
    const tr = state.tr.replaceWith(blockPos, blockPos + block.nodeSize, list)
    const textLen = itemText ? itemText.replace(/\s*\n\s*/g, ' ').length : 0
    const cursor = listCursorPos(tr.doc, blockPos, list, textLen)
    tr.setSelection(
      cursor > blockPos
        ? TextSelection.create(tr.doc, cursor)
        : Selection.near(tr.doc.resolve(Math.min(blockPos, tr.doc.content.size))),
    )
    dispatch(tr.scrollIntoView())
    return true
  })

  if (handled) return

  const chain = e.chain().focus().deleteRange(r)
  if (kind === 'bullet') chain.toggleBulletList().run()
  else if (kind === 'ordered') chain.toggleOrderedList().run()
  else chain.toggleTaskList().run()
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    hint: '#',
    search: ['heading', 'h1', 'title'],
    apply: (e, r) => applyHeading(e, r, 1),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: '##',
    search: ['heading', 'h2'],
    apply: (e, r) => applyHeading(e, r, 2),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: '###',
    search: ['heading', 'h3'],
    apply: (e, r) => applyHeading(e, r, 3),
  },
  {
    id: 'bullet',
    label: 'Bullet List',
    hint: '- item',
    search: ['bullet', 'ul', 'list', 'unordered'],
    apply: (e, r) => applyList(e, r, 'bullet'),
  },
  {
    id: 'ordered',
    label: 'Ordered List',
    hint: '1. item',
    search: ['ordered', 'numbered', 'ol', 'list'],
    apply: (e, r) => applyList(e, r, 'ordered'),
  },
  {
    id: 'task',
    label: 'Task List',
    hint: '- [ ]',
    search: ['task', 'todo', 'check', 'checkbox'],
    apply: (e, r) => applyList(e, r, 'task'),
  },
  {
    id: 'quote',
    label: 'Blockquote',
    hint: '>',
    search: ['quote', 'blockquote', 'citation'],
    apply: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Code Block',
    hint: '```',
    search: ['code', 'pre', 'snippet'],
    apply: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    id: 'table',
    label: 'Table',
    hint: '3×2',
    search: ['table', 'grid', 'rows', 'columns'],
    apply: (e, r) =>
      e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'mermaid',
    label: 'Mermaid Diagram',
    hint: '```mermaid',
    search: ['mermaid', 'diagram', 'graph', 'chart'],
    apply: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: 'graph TD\n  A --> B' }],
        })
        .run(),
  },
  {
    id: 'math',
    label: 'Math (inline)',
    hint: '$x^2$',
    search: ['math', 'inline', 'katex', 'latex', 'formula'],
    apply: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: 'mathInline', attrs: { latex: 'x^2' } })
        .run(),
  },
  {
    id: 'mathblock',
    label: 'Math Block',
    hint: '$$ … $$',
    search: ['math', 'block', 'display', 'katex', 'latex', 'equation'],
    apply: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({
          type: 'mathBlock',
          attrs: { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' },
        })
        .run(),
  },
  {
    id: 'hr',
    label: 'Horizontal Rule',
    hint: '---',
    search: ['hr', 'rule', 'divider', 'separator'],
    apply: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
]
