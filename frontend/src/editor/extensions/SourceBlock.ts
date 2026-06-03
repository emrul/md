import { Node as TiptapNode, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { renderInlineMath } from './Math'
import { imageDestination, resolvedImageSrc } from '../imagePaths'
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

interface SourceBlockOptions {
  getSourcePath: () => string | null
}

interface InlinePattern {
  re: RegExp
  cls: string
  delim: number
}

interface MdInlineToken {
  type: string
  nesting: number
  markup: string
  content: string
  attrs: [string, string][]
}

interface MdInlineParser {
  parseInline(src: string, env: object): { children?: MdInlineToken[] | null }[]
}

interface MarkdownParserStorage {
  parser?: {
    md?: MdInlineParser
  }
}

type InlineTokenReader = (text: string) => MdInlineToken[] | null

// Order matters: the two-char delimiters (**, __, ~~) run before the one-char
// emphasis so a pair isn't eaten as two singles. The single * / _ patterns use
// lookarounds so a delimiter adjacent to its double (e.g. the * inside **bold**)
// is left to the bold rule. Covers both markdown emphasis spellings since loaded
// files (and the serializer) may use either.
const PATTERNS: InlinePattern[] = [
  { re: /\*\*([^*]+)\*\*/g, cls: 'sb-bold', delim: 2 },
  { re: /__([^_]+)__/g, cls: 'sb-bold', delim: 2 },
  { re: /~~([^~]+)~~/g, cls: 'sb-strike', delim: 2 },
  { re: /(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, cls: 'sb-italic', delim: 1 },
  { re: /(?<!_)_(?!_)([^_]+?)(?<!_)_(?!_)/g, cls: 'sb-italic', delim: 1 },
  { re: /`([^`]+)`/g, cls: 'sb-code', delim: 1 },
]

const HEADING_RE = /^(#{1,6}) /
// Block/inline image: ![alt](url). Render the image and hide the raw syntax in
// hybrid mode, including when the image block has focus.
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\n]+)\)/g
// Inline link: [text](url). The text renders as a link; the brackets and the
// (url) are markers (hidden when idle, dimmed when the caret is in the block).
const LINK_RE = /(?<!!)\[([^\]]+)\]\([^)\n]+\)/g
// Inline math: $…$, excluding $$ (block) and escaped \$.
const MATH_RE = /(?<![\\$])\$([^$\n]+?)\$(?!\$)/g

function makeImageWidget(src: string, alt: string, sourcePath: string | null): HTMLElement {
  const img = document.createElement('img')
  img.className = 'sb-image'
  img.src = resolvedImageSrc(imageDestination(src), sourcePath) ?? imageDestination(src)
  img.alt = alt
  img.draggable = false
  return img
}

function marker(
  out: Decoration[],
  base: number,
  from: number,
  to: number,
  markerCls: string,
): void {
  if (to > from) out.push(Decoration.inline(base + from, base + to, { class: markerCls }))
}

function styled(out: Decoration[], base: number, from: number, to: number, cls: string): void {
  if (to > from) out.push(Decoration.inline(base + from, base + to, { class: cls }))
}

function consumeText(src: string, cursor: number, content: string): number {
  if (!content) return cursor
  return src.startsWith(content, cursor) ? cursor + content.length : -1
}

function consumeBreak(src: string, cursor: number, hard: boolean): number {
  if (!hard) return src[cursor] === '\n' ? cursor + 1 : -1
  if (src.startsWith('\\\n', cursor)) return cursor + 2
  const m = / {2,}\n/y
  m.lastIndex = cursor
  const match = m.exec(src)
  return match ? cursor + match[0].length : -1
}

function consumeDelimited(
  src: string,
  cursor: number,
  token: MdInlineToken,
): [number, number] | null {
  const delim = token.markup || '`'
  if (!src.startsWith(delim, cursor)) return null
  const contentStart = cursor + delim.length
  const close = src.indexOf(delim, contentStart)
  if (close < 0) return null
  return [close, close + delim.length]
}

function consumeInlineMath(src: string, cursor: number): [number, number] | null {
  if (src[cursor] !== '$' || src[cursor + 1] === '$') return null
  let close = cursor + 1
  while (close < src.length) {
    const ch = src[close]
    if (ch === '\n') return null
    if (ch === '\\' && src[close + 1] === '$') {
      close += 2
      continue
    }
    if (ch === '$') return [close, close + 1]
    close += 1
  }
  return null
}

function consumeInlineImage(
  src: string,
  cursor: number,
): { end: number; alt: string; dest: string } | null {
  const re = /!\[([^\]\n]*)\]\(([^)\n]+)\)/y
  re.lastIndex = cursor
  const m = re.exec(src)
  return m ? { end: cursor + m[0].length, alt: m[1], dest: m[2] } : null
}

function closeInlineLink(src: string, cursor: number): number {
  if (src[cursor] === '>') return cursor + 1
  if (src[cursor] !== ']' || src[cursor + 1] !== '(') return -1
  const end = src.indexOf(')', cursor + 2)
  return end < 0 ? -1 : end + 1
}

function decorateWithMarkdownTokens(
  text: string,
  base: number,
  active: boolean,
  sourcePath: string | null,
  markerCls: string,
  out: Decoration[],
  readInlineTokens: InlineTokenReader,
): boolean {
  const tokens = readInlineTokens(text)
  if (!tokens) return false

  let cursor = 0
  const marks: { type: string; cls: string; markerStart: number; contentStart: number }[] = []
  const links: { markerStart: number; textStart: number }[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'text_special': {
        cursor = consumeText(text, cursor, token.content)
        if (cursor < 0) return false
        break
      }
      case 'softbreak': {
        cursor = consumeBreak(text, cursor, false)
        if (cursor < 0) return false
        break
      }
      case 'hardbreak': {
        cursor = consumeBreak(text, cursor, true)
        if (cursor < 0) return false
        break
      }
      case 'strong_open':
      case 'em_open':
      case 's_open': {
        const cls =
          token.type === 'strong_open'
            ? 'sb-bold'
            : token.type === 'em_open'
              ? 'sb-italic'
              : 'sb-strike'
        const end = cursor + token.markup.length
        if (!token.markup || !text.startsWith(token.markup, cursor)) return false
        marks.push({
          type: token.type.replace('_open', ''),
          cls,
          markerStart: cursor,
          contentStart: end,
        })
        cursor = end
        break
      }
      case 'strong_close':
      case 'em_close':
      case 's_close': {
        const type = token.type.replace('_close', '')
        const frame = marks.pop()
        const end = cursor + token.markup.length
        if (
          !frame ||
          frame.type !== type ||
          !token.markup ||
          !text.startsWith(token.markup, cursor)
        ) {
          return false
        }
        styled(out, base, frame.contentStart, cursor, frame.cls)
        marker(out, base, frame.markerStart, frame.contentStart, markerCls)
        marker(out, base, cursor, end, markerCls)
        cursor = end
        break
      }
      case 'code_inline': {
        const span = consumeDelimited(text, cursor, token)
        if (!span) return false
        const [contentEnd, end] = span
        styled(out, base, cursor + (token.markup || '`').length, contentEnd, 'sb-code')
        marker(out, base, cursor, cursor + (token.markup || '`').length, markerCls)
        marker(out, base, contentEnd, end, markerCls)
        cursor = end
        break
      }
      case 'math_inline': {
        const span = consumeInlineMath(text, cursor)
        if (!span) return false
        const [contentEnd, end] = span
        if (active) {
          marker(out, base, cursor, cursor + 1, markerCls)
          marker(out, base, contentEnd, end, markerCls)
        } else {
          out.push(Decoration.inline(base + cursor, base + end, { class: 'sb-hidden' }))
          out.push(
            Decoration.widget(base + cursor, () => renderInlineMath(token.content), {
              key: `m:${token.content}`,
              side: -1,
            }),
          )
        }
        cursor = end
        break
      }
      case 'image': {
        const image = consumeInlineImage(text, cursor)
        if (!image) return false
        out.push(Decoration.inline(base + cursor, base + image.end, { class: 'sb-hidden' }))
        out.push(
          Decoration.widget(
            base + cursor,
            () => makeImageWidget(image.dest, image.alt, sourcePath),
            {
              key: `img:${base + cursor}:${text.slice(cursor, image.end)}`,
              side: -1,
            },
          ),
        )
        cursor = image.end
        break
      }
      case 'link_open': {
        const opener = token.markup === 'autolink' ? '<' : '['
        if (!text.startsWith(opener, cursor)) return false
        links.push({ markerStart: cursor, textStart: cursor + opener.length })
        cursor += opener.length
        break
      }
      case 'link_close': {
        const frame = links.pop()
        const end = closeInlineLink(text, cursor)
        if (!frame || end < 0) return false
        styled(out, base, frame.textStart, cursor, 'sb-link')
        marker(out, base, frame.markerStart, frame.textStart, markerCls)
        marker(out, base, cursor, end, markerCls)
        cursor = end
        break
      }
      default:
        return false
    }
  }

  return cursor === text.length && marks.length === 0 && links.length === 0
}

function decorateBlock(
  text: string,
  base: number,
  active: boolean,
  sourcePath: string | null,
  out: Decoration[],
  readInlineTokens: InlineTokenReader,
): void {
  const markerCls = active ? 'sb-marker' : 'sb-marker sb-hidden'
  let scanStart = 0
  const h = HEADING_RE.exec(text)
  if (h) {
    scanStart = h[0].length
    out.push(Decoration.inline(base, base + scanStart, { class: markerCls }))
  }

  const body = text.slice(scanStart)
  if (
    decorateWithMarkdownTokens(
      body,
      base + scanStart,
      active,
      sourcePath,
      markerCls,
      out,
      readInlineTokens,
    )
  ) {
    return
  }

  IMAGE_RE.lastIndex = scanStart
  let im: RegExpExecArray | null
  while ((im = IMAGE_RE.exec(text)) !== null) {
    const start = im.index
    const end = start + im[0].length
    const raw = im[0]
    const alt = im[1]
    const dest = im[2]
    out.push(Decoration.inline(base + start, base + end, { class: 'sb-hidden' }))
    out.push(
      Decoration.widget(base + start, () => makeImageWidget(dest, alt, sourcePath), {
        key: `img:${base + start}:${raw}`,
        side: -1,
      }),
    )
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
function isBlockActive(
  selectionFrom: number,
  pos: number,
  nodeSize: number,
  revealPos: number | null,
): boolean {
  return (selectionFrom > pos && selectionFrom < pos + nodeSize) || revealPos === pos
}

// Decorations for a SINGLE source block (heading sizing + inline markers).
// Tokenizing markdown per block is the expensive part, so the plugin's apply()
// recomputes only the blocks an edit or caret move actually touched instead of
// re-running this over the whole document on every transaction.
function computeBlock(
  node: PMNode,
  pos: number,
  active: boolean,
  sourcePath: string | null,
  out: Decoration[],
  readInlineTokens: InlineTokenReader,
): void {
  const h = HEADING_RE.exec(node.textContent)
  if (h) out.push(Decoration.node(pos, pos + node.nodeSize, { class: `sb-h${h[1].length}` }))
  decorateBlock(node.textContent, pos + 1, active, sourcePath, out, readInlineTokens)
}

function compute(
  state: EditorState,
  revealPos: number | null,
  getSourcePath: () => string | null,
  readInlineTokens: InlineTokenReader,
): DecorationSet {
  const out: Decoration[] = []
  const { doc, selection } = state
  const sourcePath = getSourcePath()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'sourceBlock') return true
    computeBlock(
      node,
      pos,
      isBlockActive(selection.from, pos, node.nodeSize, revealPos),
      sourcePath,
      out,
      readInlineTokens,
    )
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

export const SourceBlock = TiptapNode.create<SourceBlockOptions, SourceBlockStorage>({
  name: 'sourceBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,

  addOptions() {
    return {
      getSourcePath: () => null,
    }
  },

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
    const getSourcePath = this.options.getSourcePath
    const readInlineTokens: InlineTokenReader = (text) => {
      const md = (this.editor.storage.markdown as MarkdownParserStorage | undefined)?.parser?.md
      if (!md?.parseInline) return null
      try {
        return md.parseInline(text, {})[0]?.children ?? []
      } catch {
        return null
      }
    }

    return [
      new Plugin<DecoState>({
        key: decoKey,
        state: {
          init: (_config, state) => ({
            set: compute(state, null, getSourcePath, readInlineTokens),
            revealPos: null,
            pending: null,
          }),
          apply: (tr, value, oldState, next): DecoState => {
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
            if (!tr.docChanged && !tr.selectionSet && !meta) {
              return { set: value.set, revealPos, pending }
            }

            // Incremental rebuild. Re-tokenizing every block on each keystroke
            // makes typing scale with document size (laggy in large files), so
            // carry the prior decorations across — remapped through any doc
            // change — and recompute only the blocks the edit or the active-block
            // transition actually touched. Per-keystroke work stays proportional
            // to the edit, not the whole doc.
            const sourcePath = getSourcePath()
            let set = tr.docChanged ? value.set.map(tr.mapping, next.doc) : value.set

            // Source-block start positions (in the NEW doc) that need rebuilding.
            const dirty = new Set<number>()

            // 1. Blocks overlapping the changed ranges of each step.
            if (tr.docChanged) {
              const size = next.doc.content.size
              for (const step of tr.steps) {
                step.getMap().forEach((_fromA, _toA, fromB, toB) => {
                  next.doc.nodesBetween(Math.max(0, fromB), Math.min(toB, size), (node, pos) => {
                    if (node.type.name === 'sourceBlock') {
                      dirty.add(pos)
                      return false
                    }
                    return true
                  })
                })
              }
            }

            // 2. The block active before and the one active now: their markers
            //    show/hide on the transition, so both must be rebuilt. This is
            //    what makes a plain caret move between blocks cheap too.
            const oldSelBlock = enclosingSourceBlock(oldState, oldState.selection.from)
            if (oldSelBlock >= 0) dirty.add(tr.docChanged ? tr.mapping.map(oldSelBlock) : oldSelBlock)
            const newSelBlock = enclosingSourceBlock(next, next.selection.from)
            if (newSelBlock >= 0) dirty.add(newSelBlock)
            if (value.revealPos !== null) {
              dirty.add(tr.docChanged ? tr.mapping.map(value.revealPos) : value.revealPos)
            }
            if (revealPos !== null) dirty.add(revealPos)

            for (const pos of dirty) {
              const node = next.doc.nodeAt(pos)
              if (!node || node.type.name !== 'sourceBlock') continue
              set = set.remove(set.find(pos, pos + node.nodeSize))
              const fresh: Decoration[] = []
              computeBlock(
                node,
                pos,
                isBlockActive(next.selection.from, pos, node.nodeSize, revealPos),
                sourcePath,
                fresh,
                readInlineTokens,
              )
              if (fresh.length) set = set.add(next.doc, fresh)
            }

            return { set, revealPos, pending }
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
