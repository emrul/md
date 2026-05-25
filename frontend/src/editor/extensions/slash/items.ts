import type { Editor, Range } from '@tiptap/core'

export interface SlashItem {
  id: string
  label: string
  hint?: string
  search: string[]
  apply: (editor: Editor, range: Range) => void
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    hint: '#',
    search: ['heading', 'h1', 'title'],
    apply: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: '##',
    search: ['heading', 'h2'],
    apply: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: '###',
    search: ['heading', 'h3'],
    apply: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run(),
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
    id: 'hr',
    label: 'Horizontal Rule',
    hint: '---',
    search: ['hr', 'rule', 'divider', 'separator'],
    apply: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
]
