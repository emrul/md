import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import {
  SearchQuery,
  search,
  setSearchState,
  replaceNext,
  replaceAll as pmReplaceAll,
  type SearchResult,
} from 'prosemirror-search'
import {
  EMPTY_RESULT,
  INVALID_RESULT,
  MATCH_CAP,
  SNIPPET_PAD,
  type FindController,
  type FindMatch,
  type FindQueryInput,
  type FindResult,
} from './types'
import './find.css'

/**
 * TipTap extension that installs the prosemirror-search plugin so the editor
 * carries a query + match decorations (`ProseMirror-search-match`, and
 * `ProseMirror-active-search-match` for the match overlapping the selection).
 * The plugin re-maps its decorations on every doc/selection change, so live
 * edits keep highlights correct without us lifting a finger.
 *
 * The actual verbs live in `createPmFindEngine` — added to a tab's editor by
 * createEditor, driven by ViewController.find. Both belong here because both
 * touch ProseMirror, which the architecture keeps inside `editor/`.
 */
export const FindHighlight = Extension.create({
  name: 'findHighlight',
  addProseMirrorPlugins() {
    return [search()]
  },
})

function buildQuery(input: FindQueryInput, replace = ''): SearchQuery {
  return new SearchQuery({
    search: input.text,
    caseSensitive: input.caseSensitive,
    regexp: input.regex,
    wholeWord: input.wholeWord,
    replace,
  })
}

/** All matches across the doc, in order, up to the soft cap. */
function collectMatches(state: EditorState, query: SearchQuery): SearchResult[] {
  const out: SearchResult[] = []
  if (!query.valid) return out
  let pos = 0
  for (;;) {
    const res = query.findNext(state, pos)
    if (!res || out.length >= MATCH_CAP) break
    out.push(res)
    // Guard against zero-length matches stalling the loop.
    pos = Math.max(res.to, res.from + 1)
  }
  return out
}

/** Top-level headings with their start positions, nearest-section lookup. */
interface Section {
  pos: number
  text: string
}
function buildSections(state: EditorState): Section[] {
  const out: Section[] = []
  state.doc.forEach((node, offset) => {
    if (node.type.name === 'heading') {
      out.push({ pos: offset, text: node.textContent.replace(/\s+/g, ' ').trim() })
    } else if (node.type.name === 'sourceBlock') {
      // Hybrid heading: a source block whose first line is `#…`.
      const firstLine = node.textContent.split('\n', 1)[0]
      const m = /^\s{0,3}(#{1,6})\s+(.*\S)/.exec(firstLine)
      if (m) out.push({ pos: offset, text: m[2].replace(/\s+/g, ' ').trim() })
    }
  })
  return out
}
function sectionFor(sections: Section[], pos: number): string | undefined {
  let found: string | undefined
  for (const s of sections) {
    if (s.pos <= pos) found = s.text
    else break
  }
  return found || undefined
}

/** Context snippet within the match's text block, hit split out for rendering. */
function snippetFor(state: EditorState, from: number, to: number): Omit<FindMatch, 'index'> {
  const $from = state.doc.resolve(from)
  const blockStart = $from.start()
  const blockEnd = Math.max(blockStart, $from.end())
  const hit = state.doc.textBetween(from, Math.min(to, blockEnd), ' ', ' ')
  const beforeStart = Math.max(blockStart, from - SNIPPET_PAD)
  const afterEnd = Math.min(blockEnd, to + SNIPPET_PAD)
  let before = state.doc.textBetween(beforeStart, from, ' ', ' ')
  let after = state.doc.textBetween(Math.min(to, blockEnd), afterEnd, ' ', ' ')
  if (beforeStart > blockStart) before = '…' + before
  if (afterEnd < blockEnd) after = after + '…'
  return { before, hit, after }
}

export function createPmFindEngine(editor: Editor): FindController {
  let lastInput: FindQueryInput | null = null
  let armed = false

  const dispatch = (tr: import('@tiptap/pm/state').Transaction): void => editor.view.dispatch(tr)

  function setSearch(query: SearchQuery): void {
    dispatch(setSearchState(editor.state.tr, query))
  }

  /** The index of the match coinciding with the current selection (the active
   * match, since prosemirror-search keys "active" off the selection). */
  function activeIndex(matches: SearchResult[]): number {
    const sel = editor.state.selection
    return matches.findIndex((m) => m.from === sel.from && m.to === sel.to)
  }

  function buildResult(matches: SearchResult[]): FindResult {
    const state = editor.state
    const sections = buildSections(state)
    const list: FindMatch[] = matches.map((m, i) => ({
      index: i,
      ...snippetFor(state, m.from, m.to),
      section: sectionFor(sections, m.from),
    }))
    return {
      valid: true,
      total: matches.length,
      active: activeIndex(matches),
      capped: matches.length >= MATCH_CAP,
      matches: list,
    }
  }

  /** Move the selection onto a match (so it becomes the active highlight) and
   * scroll it to the center of the view. PM's transaction scrollIntoView only
   * nudges minimally — and can leave the hit tucked under the floating panel —
   * so we center the match's DOM node explicitly. */
  function selectAndScroll(m: SearchResult): void {
    const { state, view } = editor
    const sel = TextSelection.create(state.doc, m.from, m.to)
    dispatch(state.tr.setSelection(sel))
    const node = view.domAtPos(m.from)?.node
    const el = node && node.nodeType === 1 ? (node as HTMLElement) : (node?.parentElement ?? null)
    el?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }

  function move(dir: 1 | -1): FindResult {
    if (!armed || !lastInput) return current()
    const matches = collectMatches(editor.state, buildQuery(lastInput))
    if (!matches.length) return buildResult(matches)
    let cur = activeIndex(matches)
    if (cur < 0) cur = dir > 0 ? -1 : 0
    const ni = (cur + dir + matches.length) % matches.length
    selectAndScroll(matches[ni])
    return buildResult(matches)
  }

  function current(): FindResult {
    if (!armed || !lastInput) return EMPTY_RESULT
    const query = buildQuery(lastInput)
    if (!query.valid) return INVALID_RESULT
    return buildResult(collectMatches(editor.state, query))
  }

  return {
    setQuery(input: FindQueryInput): FindResult {
      lastInput = input
      const isEmpty = input.text.length === 0
      const query = buildQuery(input)
      if (isEmpty || !query.valid) {
        armed = false
        setSearch(new SearchQuery({ search: '' }))
        return isEmpty ? EMPTY_RESULT : INVALID_RESULT
      }
      armed = true
      setSearch(query)
      const matches = collectMatches(editor.state, query)
      if (matches.length) {
        const caret = editor.state.selection.from
        let ai = matches.findIndex((m) => m.from >= caret)
        if (ai < 0) ai = 0
        selectAndScroll(matches[ai])
      }
      return buildResult(matches)
    },
    next: () => move(1),
    prev: () => move(-1),
    goto(index: number): FindResult {
      if (!lastInput) return current()
      const matches = collectMatches(editor.state, buildQuery(lastInput))
      if (index < 0 || index >= matches.length) return buildResult(matches)
      selectAndScroll(matches[index])
      return buildResult(matches)
    },
    replace(replacement: string): FindResult {
      if (!armed || !lastInput) return current()
      setSearch(buildQuery(lastInput, replacement))
      replaceNext(editor.state, dispatch)
      return current()
    },
    replaceAll(replacement: string): number {
      if (!armed || !lastInput) return 0
      const count = collectMatches(editor.state, buildQuery(lastInput)).length
      setSearch(buildQuery(lastInput, replacement))
      pmReplaceAll(editor.state, dispatch)
      return count
    },
    selectedText(): string {
      const { from, to, empty } = editor.state.selection
      if (empty) return ''
      return editor.state.doc.textBetween(from, to, '\n')
    },
    current,
    hasQuery: () => armed,
    clear(): void {
      armed = false
      lastInput = null
      setSearch(new SearchQuery({ search: '' }))
    },
  }
}
