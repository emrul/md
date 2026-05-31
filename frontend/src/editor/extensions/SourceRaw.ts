import Paragraph from '@tiptap/extension-paragraph'
import Heading from '@tiptap/extension-heading'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { defaultMarkdownSerializer } from 'prosemirror-markdown'

/**
 * Lossless hybrid ⇄ WYSIWYG switching (see ../md-pro/docs/lossless-mode-switch-plan.md).
 *
 * A top-level paragraph/heading carries `sourceRaw` — the exact markdown it was
 * built from — so an *unedited* block keeps its original spelling (manual line
 * wraps, `_emphasis_`, …) when it serializes back, instead of being reflowed by
 * the WYSIWYG parse→serialize round-trip. The attribute is:
 *   - stamped when a source block becomes a WYSIWYG block (mode.ts), and
 *   - cleared the moment the block's content is edited (invalidator below),
 * so edited blocks serialize normally while untouched ones stay byte-exact.
 */

// Transactions that intentionally stamp sourceRaw (mode switch / load) tag
// themselves with this meta so the invalidator doesn't treat them as edits.
export const SOURCE_RAW_STAMP = 'sourceRawStamp'

const sourceRawAttribute = {
  sourceRaw: {
    default: null,
    rendered: false, // model-only — never touches the DOM / HTML round-trip
    keepOnSplit: false, // a split is an edit; the new block gets fresh content
  },
}

// MarkdownNodeSpec serialize: emit the cached raw verbatim when present, else
// fall back to the stock serializer. `state` is tiptap-markdown's
// MarkdownSerializerState (a prosemirror-markdown subclass).
type SerializeFn = (state: { write(s: string): void; closeBlock(n: PMNode): void }, node: PMNode) => void
function serializeRawOr(fallback: SerializeFn): SerializeFn {
  return (state, node) => {
    const raw = node.attrs.sourceRaw as string | null
    if (raw != null) {
      state.write(raw)
      state.closeBlock(node)
    } else {
      fallback(state, node)
    }
  }
}

export const RawParagraph = Paragraph.extend({
  addAttributes() {
    return { ...this.parent?.(), ...sourceRawAttribute }
  },
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: serializeRawOr(defaultMarkdownSerializer.nodes.paragraph as SerializeFn),
        parse: {},
      },
    }
  },
})

export const RawHeading = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), ...sourceRawAttribute }
  },
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: serializeRawOr(defaultMarkdownSerializer.nodes.heading as SerializeFn),
        parse: {},
      },
    }
  },
})

const isTextBlock = (name: string): boolean => name === 'paragraph' || name === 'heading'

/**
 * Clears `sourceRaw` on any paragraph/heading whose content an edit touched, so
 * a cached block reverts to normal (fresh) serialization once changed. Stamping
 * transactions (mode switch / load) are exempt via SOURCE_RAW_STAMP. Idempotent
 * — re-running finds nothing to clear — so it can't loop.
 */
export const SourceRawInvalidator = Extension.create({
  name: 'sourceRawInvalidator',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (transactions.some((t) => t.getMeta(SOURCE_RAW_STAMP))) return null
          if (!transactions.some((t) => t.docChanged)) return null

          const max = newState.doc.content.size
          const seen = new Set<number>()
          let tr: ReturnType<typeof newState.tr.setNodeMarkup> | null = null
          for (const t of transactions) {
            for (const step of t.steps) {
              step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                newState.doc.nodesBetween(newStart, Math.min(newEnd, max), (node, pos) => {
                  if (isTextBlock(node.type.name) && node.attrs.sourceRaw != null && !seen.has(pos)) {
                    seen.add(pos)
                    tr = (tr ?? newState.tr).setNodeMarkup(pos, undefined, {
                      ...node.attrs,
                      sourceRaw: null,
                    })
                  }
                })
              })
            }
          }
          return tr
        },
      }),
    ]
  },
})
