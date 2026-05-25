import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'

type Align = 'left' | 'center' | 'right' | null

function parseAlign(element: HTMLElement): Align {
  const style = element.style.textAlign
  if (style === 'left' || style === 'center' || style === 'right') return style
  const attr = element.getAttribute('align')
  if (attr === 'left' || attr === 'center' || attr === 'right') return attr
  return null
}

function renderAlign(value: unknown): Record<string, string> {
  if (value === 'left' || value === 'center' || value === 'right') {
    return { style: `text-align: ${value}` }
  }
  return {}
}

export const AlignedTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: parseAlign,
        renderHTML: (attrs: { textAlign?: Align }) => renderAlign(attrs.textAlign),
      },
    }
  },
})

export const AlignedTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: parseAlign,
        renderHTML: (attrs: { textAlign?: Align }) => renderAlign(attrs.textAlign),
      },
    }
  },
})
