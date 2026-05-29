import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Mark, Node as PMNode } from '@tiptap/pm/model'
import './hybrid.css'

const SUPPORTED_MARKS = new Set(['bold', 'italic', 'strike', 'code', 'link'])

function makeMarker(
  pos: number,
  text: string,
  side: number,
  key: string,
  extraClass = '',
): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const span = document.createElement('span')
      span.className = extraClass ? `hybrid-marker ${extraClass}` : 'hybrid-marker'
      span.textContent = text
      return span
    },
    { side, key, ignoreSelection: true },
  )
}

function openMarker(name: string): string {
  switch (name) {
    case 'bold':
      return '**'
    case 'italic':
      return '_'
    case 'strike':
      return '~~'
    case 'code':
      return '`'
    case 'link':
      return '['
    default:
      return ''
  }
}

function closeMarker(name: string, mark: Mark): string {
  switch (name) {
    case 'bold':
      return '**'
    case 'italic':
      return '_'
    case 'strike':
      return '~~'
    case 'code':
      return '`'
    case 'link': {
      const href = (mark.attrs.href as string | undefined) ?? ''
      return `](${href})`
    }
    default:
      return ''
  }
}

function addInlineMarkers(blockNode: PMNode, blockPos: number, decorations: Decoration[]): void {
  if (!blockNode.isTextblock) return

  type ActiveMark = { mark: Mark; openedAt: number }
  const active = new Map<string, ActiveMark>()
  let pos = blockPos + 1
  let widgetSeq = 0

  blockNode.forEach((child) => {
    const childMarks = new Map<string, Mark>()
    for (const m of child.marks) {
      if (SUPPORTED_MARKS.has(m.type.name)) childMarks.set(m.type.name, m)
    }

    for (const [name, info] of Array.from(active.entries()).reverse()) {
      if (!childMarks.has(name)) {
        decorations.push(
          makeMarker(pos, closeMarker(name, info.mark), -1, `close-${name}-${widgetSeq++}`),
        )
        active.delete(name)
      }
    }

    for (const [name, mark] of childMarks) {
      if (!active.has(name)) {
        decorations.push(makeMarker(pos, openMarker(name), 1, `open-${name}-${widgetSeq++}`))
        active.set(name, { mark, openedAt: pos })
      }
    }

    pos += child.nodeSize
  })

  for (const [name, info] of Array.from(active.entries()).reverse()) {
    decorations.push(
      makeMarker(pos, closeMarker(name, info.mark), -1, `close-${name}-${widgetSeq++}`),
    )
  }
}

function addBlockMarkers(doc: PMNode, from: number, to: number, decorations: Decoration[]): void {
  doc.descendants((node, pos, parent, index) => {
    const nodeEnd = pos + node.nodeSize
    if (nodeEnd < from || pos > to) return false

    switch (node.type.name) {
      case 'heading': {
        const level = (node.attrs.level as number | undefined) ?? 1
        decorations.push(makeMarker(pos + 1, '#'.repeat(level) + ' ', -1, `head-${pos}-${level}`))
        addInlineMarkers(node, pos, decorations)
        return false
      }
      case 'paragraph': {
        if (parent?.type.name === 'blockquote') {
          decorations.push(makeMarker(pos + 1, '> ', -1, `bq-${pos}`))
        }
        addInlineMarkers(node, pos, decorations)
        return false
      }
      case 'codeBlock': {
        const lang = (node.attrs.language as string | undefined) ?? ''
        decorations.push(
          makeMarker(pos + 1, '```' + lang, -1, `cb-open-${pos}`, 'hybrid-fence'),
        )
        decorations.push(
          makeMarker(pos + node.nodeSize - 1, '```', 1, `cb-close-${pos}`, 'hybrid-fence'),
        )
        return false
      }
      case 'listItem': {
        const isOrdered = parent?.type.name === 'orderedList'
        const number = (index ?? 0) + 1
        const marker = isOrdered ? `${number}. ` : '- '
        decorations.push(makeMarker(pos + 2, marker, -1, `li-${pos}`))
        // Hide the rendered bullet/number on this revealed row so it doesn't
        // appear alongside the markdown source (e.g. "• - item").
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, { class: 'hybrid-li-revealed' }),
        )
        return true
      }
      case 'taskItem': {
        const checked = node.attrs.checked === true
        const marker = checked ? '- [x] ' : '- [ ] '
        decorations.push(makeMarker(pos + 2, marker, -1, `task-${pos}`))
        // Hide the rendered checkbox on this revealed row; the source markup
        // ("- [ ] " / "- [x] ") stands in for it.
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, { class: 'hybrid-task-revealed' }),
        )
        return true
      }
      case 'blockquote':
      case 'bulletList':
      case 'orderedList':
      case 'doc':
        return true
      case 'horizontalRule':
        return false
      default:
        return true
    }
  })
}

function computeDecorations(state: EditorState): DecorationSet {
  const { doc, selection } = state
  const decorations: Decoration[] = []
  addBlockMarkers(doc, selection.from, selection.to, decorations)
  return DecorationSet.create(doc, decorations)
}

const hybridKey = new PluginKey<DecorationSet>('hybrid-reveal')

export const HybridReveal = Extension.create({
  name: 'hybridReveal',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: hybridKey,
        state: {
          init(_config, state) {
            return computeDecorations(state)
          },
          apply(tr: Transaction, value: DecorationSet, _oldState, newState) {
            if (!tr.docChanged && !tr.selectionSet) return value
            return computeDecorations(newState)
          },
        },
        props: {
          decorations(state) {
            return hybridKey.getState(state) ?? null
          },
        },
      }),
    ]
  },
})
