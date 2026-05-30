import { Node as TiptapNode, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { renderInlineMath } from './Math'
import './source-block.css'

// SPIKE: a text block whose content is always raw markdown text, styled live
// with INLINE DECORATIONS (no marks, no widgets, no DOM swap):
//   - idle  → markers (# ** _ ~~ `) hidden, inner text styled → looks rendered
//   - active→ markers shown (dimmed) + inner text styled        → source + styling
// Headings: a leading "#{1,6} " sizes the whole block and the prefix is a marker.
//
// Entering a block reveals its markers, which reflows the text. To avoid the
// caret painting at a stale position, entry is two-phase (reveal + bounce caret
// back this frame, place it next frame). Vertical (up/down) entry additionally
// re-targets via posAtCoords against the revealed layout so the caret keeps its
// column instead of drifting.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sourceBlock: {
      insertSourceBlock: (text?: string) => ReturnType
      // Wrap/unwrap the selection with a literal markdown delimiter (e.g. "**").
      // The source-block analogue of toggleBold/Italic/… since the block holds
      // raw markdown and disallows marks.
      toggleSourceWrap: (delim: string) => ReturnType
      // Toggle a leading "#{level} " prefix on the enclosing source block.
      // level 0 strips any heading prefix (→ plain paragraph). The source-block
      // analogue of toggleHeading; the literal "#" is what makes it a heading.
      toggleSourceHeading: (level: number) => ReturnType
    }
  }
}

interface SourceBlockStorage {
  markdown: {
    serialize: (
      state: { write: (s: string) => void; closeBlock: (n: PMNode) => void },
      node: PMNode,
    ) => void
    parse: Record<string, never>
  }
}

interface InlinePattern {
  re: RegExp
  cls: string
  delim: number
}

// Order matters: the two-char delimiters (**, __, ~~) run before the one-char
// emphasis so a pair isn't eaten as two singles. The single * / _ patterns use
// lookarounds so a delimiter adjacent to its double (e.g. the * inside **bold**)
// is left to the bold rule. Covers both markdown emphasis spellings since loaded
// files (and the serializer) may use either.
const PATTERNS: InlinePattern[] = [
  { re: /\*\*([^*\n]+)\*\*/g, cls: 'sb-bold', delim: 2 },
  { re: /__([^_\n]+)__/g, cls: 'sb-bold', delim: 2 },
  { re: /~~([^~\n]+)~~/g, cls: 'sb-strike', delim: 2 },
  { re: /(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, cls: 'sb-italic', delim: 1 },
  { re: /(?<!_)_(?!_)([^_\n]+?)(?<!_)_(?!_)/g, cls: 'sb-italic', delim: 1 },
  { re: /`([^`\n]+)`/g, cls: 'sb-code', delim: 1 },
]

const HEADING_RE = /^(#{1,6}) /
// Inline link: [text](url). The text renders as a link; the brackets and the
// (url) are markers (hidden when idle, dimmed when the caret is in the block).
const LINK_RE = /\[([^\]\n]+)\]\([^)\n]+\)/g
// Inline math: $…$, excluding $$ (block) and escaped \$.
const MATH_RE = /(?<![\\$])\$([^$\n]+?)\$(?!\$)/g

function decorateBlock(text: string, base: number, active: boolean, out: Decoration[]): void {
  const markerCls = active ? 'sb-marker' : 'sb-marker sb-hidden'
  let scanStart = 0
  const h = HEADING_RE.exec(text)
  if (h) {
    scanStart = h[0].length
    out.push(Decoration.inline(base, base + scanStart, { class: markerCls }))
  }
  LINK_RE.lastIndex = scanStart
  let lm: RegExpExecArray | null
  while ((lm = LINK_RE.exec(text)) !== null) {
    const start = lm.index
    const textStart = start + 1
    const textEnd = textStart + lm[1].length
    const end = start + lm[0].length
    out.push(Decoration.inline(base + start, base + textStart, { class: markerCls }))
    out.push(Decoration.inline(base + textStart, base + textEnd, { class: 'sb-link' }))
    out.push(Decoration.inline(base + textEnd, base + end, { class: markerCls }))
  }
  // Inline math: idle → hide the raw $…$ and render it; active → show raw with
  // dimmed $ delimiters so it's editable.
  MATH_RE.lastIndex = scanStart
  let mm: RegExpExecArray | null
  while ((mm = MATH_RE.exec(text)) !== null) {
    const start = mm.index
    const end = start + mm[0].length
    const latex = mm[1]
    if (active) {
      out.push(Decoration.inline(base + start, base + start + 1, { class: markerCls }))
      out.push(Decoration.inline(base + end - 1, base + end, { class: markerCls }))
    } else {
      out.push(Decoration.inline(base + start, base + end, { class: 'sb-hidden' }))
      out.push(
        Decoration.widget(base + start, () => renderInlineMath(latex), {
          key: `m:${latex}`,
          side: -1,
        }),
      )
    }
  }
  for (const { re, cls, delim } of PATTERNS) {
    re.lastIndex = scanStart
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = m.index
      const end = start + m[0].length
      const cStart = start + delim
      const cEnd = end - delim
      out.push(Decoration.inline(base + cStart, base + cEnd, { class: cls }))
      out.push(Decoration.inline(base + start, base + cStart, { class: markerCls }))
      out.push(Decoration.inline(base + cEnd, base + end, { class: markerCls }))
    }
  }
}

// revealPos forces a block active even when the caret isn't inside it yet.
function compute(state: EditorState, revealPos: number | null): DecorationSet {
  const out: Decoration[] = []
  const { doc, selection } = state
  doc.descendants((node, pos) => {
    if (node.type.name !== 'sourceBlock') return true
    const active =
      (selection.from > pos && selection.from < pos + node.nodeSize) || revealPos === pos
    const h = HEADING_RE.exec(node.textContent)
    if (h) out.push(Decoration.node(pos, pos + node.nodeSize, { class: `sb-h${h[1].length}` }))
    decorateBlock(node.textContent, pos + 1, active, out)
    return false
  })
  return DecorationSet.create(doc, out)
}

function enclosingSourceBlock(state: EditorState, pos: number): number {
  const $pos = state.doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'sourceBlock') return $pos.before(d)
  }
  return -1
}

interface Pending {
  caret: number
  vertical: boolean
  blockPos: number
  from: number
}

interface DecoState {
  set: DecorationSet
  revealPos: number | null
  pending: Pending | null
}

const decoKey = new PluginKey<DecoState>('source-block-deco')

export const SourceBlock = TiptapNode.create<unknown, SourceBlockStorage>({
  name: 'sourceBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,

  parseHTML() {
    return [{ tag: 'div[data-source-block]', preserveWhitespace: 'full' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-source-block': '', class: 'source-block' }),
      0,
    ]
  },

  // The content is already markdown, so serializing is just writing it out —
  // fixes the "[sourceBlock]" placeholder in source view / copy-paste.
  addStorage(): SourceBlockStorage {
    return {
      markdown: {
        serialize(state, node) {
          state.write(node.textContent)
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },

  addCommands() {
    return {
      insertSourceBlock:
        (text = 'The **quick** _brown_ ~~fox~~ jumps over the `lazy` dog.') =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [{ type: 'text', text }],
          }),

      toggleSourceWrap:
        (delim: string) =>
        ({ state, dispatch }) => {
          const { selection, doc } = state
          const { $from, from, to } = selection
          let blockDepth = -1
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'sourceBlock') {
              blockDepth = d
              break
            }
          }
          if (blockDepth < 0) return false
          if (!dispatch) return true

          const blockStart = $from.start(blockDepth)
          const blockEnd = $from.end(blockDepth)
          const d = delim.length
          const tr = state.tr

          // Empty selection: drop a paired delimiter and park the caret inside.
          if (from === to) {
            tr.insertText(delim + delim, from)
            tr.setSelection(TextSelection.create(tr.doc, from + d))
            dispatch(tr.scrollIntoView())
            return true
          }

          const selected = doc.textBetween(from, to)
          // Unwrap when the selection itself spans the delimiters.
          if (selected.length >= 2 * d && selected.startsWith(delim) && selected.endsWith(delim)) {
            const inner = selected.slice(d, selected.length - d)
            tr.insertText(inner, from, to)
            tr.setSelection(TextSelection.create(tr.doc, from, from + inner.length))
            dispatch(tr.scrollIntoView())
            return true
          }
          // Unwrap when the delimiters flank the selection (idle markers are
          // display:none, so a rendered word selects without them).
          const beforeStart = from - d
          const afterEnd = to + d
          if (
            beforeStart >= blockStart &&
            afterEnd <= blockEnd &&
            doc.textBetween(beforeStart, from) === delim &&
            doc.textBetween(to, afterEnd) === delim
          ) {
            tr.delete(to, afterEnd)
            tr.delete(beforeStart, from)
            tr.setSelection(TextSelection.create(tr.doc, beforeStart, beforeStart + (to - from)))
            dispatch(tr.scrollIntoView())
            return true
          }
          // Otherwise wrap. Insert the trailing delimiter first so the leading
          // insert position stays valid.
          tr.insertText(delim, to)
          tr.insertText(delim, from)
          tr.setSelection(TextSelection.create(tr.doc, from + d, to + d))
          dispatch(tr.scrollIntoView())
          return true
        },

      toggleSourceHeading:
        (level: number) =>
        ({ state, dispatch }) => {
          const { $from } = state.selection
          let blockDepth = -1
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'sourceBlock') {
              blockDepth = d
              break
            }
          }
          if (blockDepth < 0) return false
          if (!dispatch) return true

          const blockStart = $from.start(blockDepth)
          const text = $from.node(blockDepth).textContent
          const m = HEADING_RE.exec(text)
          const tr = state.tr
          const prefix = '#'.repeat(level) + ' '
          if (m && (m[1].length === level || level === 0)) {
            // Toggle off (same level) or demote to paragraph (level 0).
            tr.delete(blockStart, blockStart + m[0].length)
          } else if (m) {
            // Replace the existing prefix with the requested level.
            tr.insertText(prefix, blockStart, blockStart + m[0].length)
          } else if (level > 0) {
            tr.insertText(prefix, blockStart)
          } else {
            return true // level 0 on a block with no prefix: nothing to do.
          }
          dispatch(tr.scrollIntoView())
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      // The block is code-spec (literal markdown), so the base keymap would
      // insert a newline on Enter. Instead split into a fresh source block so
      // Enter creates blocks, MarkText-style. Other blocks fall through.
      Enter: () => {
        const { state } = this.editor
        const { $from } = state.selection
        if ($from.parent.type !== this.type) return false
        return this.editor.commands.command(({ tr, dispatch }) => {
          if (dispatch) {
            tr.deleteSelection()
            tr.split(tr.selection.from)
            dispatch(tr.scrollIntoView())
          }
          return true
        })
      },
    }
  },

  addProseMirrorPlugins() {
    let lastWasVertical = false

    return [
      new Plugin<DecoState>({
        key: decoKey,
        state: {
          init: (_config, state) => ({ set: compute(state, null), revealPos: null, pending: null }),
          apply: (tr, value, _old, next): DecoState => {
            const meta = tr.getMeta(decoKey) as
              | { revealPos?: number | null; pending?: Pending | null }
              | undefined
            let revealPos = value.revealPos
            let pending = value.pending
            if (meta && 'revealPos' in meta) revealPos = meta.revealPos ?? null
            else if (tr.selectionSet) revealPos = null
            if (meta && 'pending' in meta) pending = meta.pending ?? null
            else if (tr.selectionSet) pending = null
            if (tr.docChanged) {
              if (revealPos !== null) revealPos = tr.mapping.map(revealPos)
              pending = null // drop any pending placement across edits
            }
            if (tr.docChanged || tr.selectionSet || meta) {
              return { set: compute(next, revealPos), revealPos, pending }
            }
            return { set: value.set, revealPos, pending }
          },
        },

        appendTransaction(_trs, oldState, newState): Transaction | null {
          if (oldState.selection.eq(newState.selection)) return null
          const sel = newState.selection
          if (!sel.empty) return null
          const blockPos = enclosingSourceBlock(newState, sel.from)
          if (blockPos < 0) return null
          const node = newState.doc.nodeAt(blockPos)
          if (!node) return null
          const prev = decoKey.getState(oldState)
          const wasRevealed = prev?.revealPos === blockPos
          const wasInside =
            oldState.selection.from > blockPos && oldState.selection.from < blockPos + node.nodeSize
          if (wasRevealed || wasInside) return null
          const from = oldState.selection.from
          const back = Math.min(from, newState.doc.content.size)
          return newState.tr
            .setSelection(TextSelection.create(newState.doc, back))
            .setMeta(decoKey, {
              revealPos: blockPos,
              pending: { caret: sel.from, vertical: lastWasVertical, blockPos, from },
            })
        },

        props: {
          decorations(state) {
            return decoKey.getState(state)?.set ?? null
          },
          handleKeyDown(_view, event) {
            lastWasVertical = event.key === 'ArrowUp' || event.key === 'ArrowDown'
            return false
          },
          handleDOMEvents: {
            mousedown() {
              lastWasVertical = false
              return false
            },
          },
        },

        view: () => ({
          update(view) {
            const st = decoKey.getState(view.state)
            if (!st || !st.pending) return
            const pending = st.pending
            requestAnimationFrame(() => {
              if (view.isDestroyed) return
              const s = view.state
              const cur = decoKey.getState(s)
              if (!cur || cur.pending?.caret !== pending.caret) return // superseded
              const node = s.doc.nodeAt(pending.blockPos)
              if (!node) {
                view.dispatch(s.tr.setMeta(decoKey, { pending: null }))
                return
              }
              let target = pending.caret
              // Vertical entry: keep the caret's column by re-targeting against
              // the now-revealed layout (the markers shifted the columns).
              if (pending.vertical) {
                const dom = view.nodeDOM(pending.blockPos) as HTMLElement | null
                let goalX: number | null = null
                try {
                  goalX = view.coordsAtPos(s.selection.from).left
                } catch {
                  goalX = null
                }
                if (dom && goalX !== null) {
                  const rect = dom.getBoundingClientRect()
                  const fromAbove = pending.from < pending.blockPos
                  const y = fromAbove ? rect.top + 6 : rect.bottom - 6
                  const found = view.posAtCoords({ left: goalX, top: y })
                  if (found) {
                    const min = pending.blockPos + 1
                    const max = pending.blockPos + node.nodeSize - 1
                    target = Math.max(min, Math.min(max, found.pos))
                  }
                }
              }
              if (target < 0 || target > s.doc.content.size) {
                view.dispatch(s.tr.setMeta(decoKey, { pending: null }))
                return
              }
              view.dispatch(s.tr.setSelection(TextSelection.create(s.doc, target)))
            })
          },
        }),
      }),
    ]
  },
})
