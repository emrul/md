// Minimal markdown-it plugin: recognises `$...$` (inline) and `$$\n...\n$$`
// (block) and emits HTML nodes our TipTap MathInline / MathBlock NodeViews
// can parse — they read the latex source from data-math-* attributes.

import type MarkdownIt from 'markdown-it'
import type { RuleInline } from 'markdown-it/lib/parser_inline.mjs'
import type { RuleBlock } from 'markdown-it/lib/parser_block.mjs'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const mathInline: RuleInline = (state, silent) => {
  if (state.src[state.pos] !== '$') return false

  // Don't match $$ at start (that's block-level).
  if (state.src[state.pos + 1] === '$') return false

  // Don't open right after an alphanumeric (e.g. $1, "foo$bar"); these are
  // usually currency or identifiers, not math.
  const prevChar = state.pos > 0 ? state.src[state.pos - 1] : ''
  if (/\w/.test(prevChar)) return false

  // Find closing $ on the same line, ignoring escaped \$.
  let end = state.pos + 1
  while (end < state.posMax) {
    const ch = state.src[end]
    if (ch === '\n') return false
    if (ch === '\\' && state.src[end + 1] === '$') {
      end += 2
      continue
    }
    if (ch === '$') break
    end += 1
  }
  if (end >= state.posMax) return false
  if (end === state.pos + 1) return false // empty $$

  const content = state.src.slice(state.pos + 1, end)
  if (!content.trim()) return false

  if (!silent) {
    const token = state.push('math_inline', 'span', 0)
    token.markup = '$'
    token.content = content
  }
  state.pos = end + 1
  return true
}

const mathBlock: RuleBlock = (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]
  if (max - start < 2) return false
  if (state.src[start] !== '$' || state.src[start + 1] !== '$') return false

  // First-line content after the opening `$$`.
  let firstLineRest = state.src.slice(start + 2, max).trim()
  let nextLine = startLine

  // Single-line form: $$...$$
  if (firstLineRest.endsWith('$$')) {
    firstLineRest = firstLineRest.slice(0, -2).trim()
    if (!silent) {
      const token = state.push('math_block', 'div', 0)
      token.block = true
      token.markup = '$$'
      token.content = firstLineRest
      token.map = [startLine, startLine + 1]
    }
    state.line = startLine + 1
    return true
  }

  // Multi-line form: find a line that is exactly `$$`.
  let found = false
  for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
    const lineEnd = state.eMarks[nextLine]
    const line = state.src.slice(lineStart, lineEnd).trim()
    if (line === '$$') {
      found = true
      break
    }
  }
  if (!found) return false

  const content = state.getLines(startLine + 1, nextLine, state.tShift[startLine], false).trim()
  // Prepend any text after the opening `$$` on the first line.
  const fullContent = firstLineRest ? `${firstLineRest}\n${content}` : content

  if (!silent) {
    const token = state.push('math_block', 'div', 0)
    token.block = true
    token.markup = '$$'
    token.content = fullContent
    token.map = [startLine, nextLine + 1]
  }
  state.line = nextLine + 1
  return true
}

export function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'math_inline', mathInline)
  md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  md.renderer.rules.math_inline = (tokens, idx) => {
    const latex = tokens[idx]?.content ?? ''
    return `<span data-math-inline="${esc(latex)}"></span>`
  }
  md.renderer.rules.math_block = (tokens, idx) => {
    const latex = tokens[idx]?.content ?? ''
    return `<div data-math-block="${esc(latex)}"></div>`
  }
}
