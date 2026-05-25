import Table from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'

type Align = 'left' | 'center' | 'right' | null

function alignDelimiter(align: Align): string {
  switch (align) {
    case 'left':
      return ':---'
    case 'center':
      return ':---:'
    case 'right':
      return '---:'
    default:
      return '---'
  }
}

function childArray(node: PMNode): PMNode[] {
  const out: PMNode[] = []
  node.forEach((c) => {
    out.push(c)
  })
  return out
}

function isSerializable(table: PMNode): boolean {
  const rows = childArray(table)
  if (rows.length === 0) return false
  const headerRow = rows[0]
  if (!headerRow) return false
  const headerCells = childArray(headerRow)
  if (headerCells.some((c) => c.type.name !== 'tableHeader')) return false
  for (const cell of headerCells) {
    if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) return false
    if (cell.childCount > 1) return false
  }
  for (const row of rows.slice(1)) {
    for (const cell of childArray(row)) {
      if (cell.type.name === 'tableHeader') return false
      if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) return false
      if (cell.childCount > 1) return false
    }
  }
  return true
}

export const AlignedTable = Table.extend({
  addStorage() {
    const parent = this.parent?.()
    return {
      ...parent,
      markdown: {
        serialize(
          state: {
            write: (s: string) => void
            renderInline: (n: PMNode) => void
            ensureNewLine: () => void
            closeBlock: (n: PMNode) => void
            inTable?: boolean
          },
          node: PMNode,
        ) {
          if (!isSerializable(node)) {
            // Bail to HTML rendering for unsupported tables.
            state.write('<table>')
            state.ensureNewLine()
            // Fallback: stringify text content rows; reader can edit raw HTML.
            node.forEach((row) => {
              state.write('<tr>')
              row.forEach((cell) => {
                state.write(`<${cell.type.name === 'tableHeader' ? 'th' : 'td'}>${cell.textContent}</${cell.type.name === 'tableHeader' ? 'th' : 'td'}>`)
              })
              state.write('</tr>')
              state.ensureNewLine()
            })
            state.write('</table>')
            state.closeBlock(node)
            return
          }

          state.inTable = true
          const rows = childArray(node)
          const headerRow = rows[0]
          const headerCells = headerRow ? childArray(headerRow) : []
          const columnAligns: Align[] = headerCells.map(
            (c) => (c.attrs.textAlign as Align) ?? null,
          )

          rows.forEach((row, i) => {
            state.write('| ')
            row.forEach((cell, _p, j) => {
              if (j) state.write(' | ')
              const inner = cell.firstChild
              if (inner && inner.textContent.trim()) {
                state.renderInline(inner)
              }
            })
            state.write(' |')
            state.ensureNewLine()
            if (i === 0) {
              const delim = columnAligns.map(alignDelimiter).join(' | ')
              state.write(`| ${delim} |`)
              state.ensureNewLine()
            }
          })
          state.closeBlock(node)
          state.inTable = false
        },
        parse: {
          // handled by markdown-it
        },
      },
    }
  },
})
