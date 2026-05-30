import type { Editor, Range } from '@tiptap/core'

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
    apply: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Ordered List',
    hint: '1. item',
    search: ['ordered', 'numbered', 'ol', 'list'],
    apply: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    id: 'task',
    label: 'Task List',
    hint: '- [ ]',
    search: ['task', 'todo', 'check', 'checkbox'],
    apply: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
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
