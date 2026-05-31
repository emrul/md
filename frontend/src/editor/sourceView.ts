import { EditorState, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
  redo as cmRedo,
  redoDepth as cmRedoDepth,
  undo as cmUndo,
  undoDepth as cmUndoDepth,
} from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import {
  SearchQuery,
  search,
  setSearchQuery,
  getSearchQuery,
  replaceNext as cmReplaceNext,
  replaceAll as cmReplaceAll,
} from '@codemirror/search'
import {
  EMPTY_RESULT,
  INVALID_RESULT,
  MATCH_CAP,
  SNIPPET_PAD,
  type FindController,
  type FindMatch,
  type FindQueryInput,
  type FindResult,
} from './find/types'
import './source-view.css'
import './find/find.css'

function fencedLineDeco(isFirst: boolean, isLast: boolean): Decoration {
  const classes = ['cm-fenced-code']
  if (isFirst) classes.push('cm-fenced-code-first')
  if (isLast) classes.push('cm-fenced-code-last')
  return Decoration.line({ attributes: { class: classes.join(' ') } })
}

function buildFencedCodeDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'FencedCode') return
        const startLine = doc.lineAt(node.from)
        const endLine = doc.lineAt(Math.min(node.to, doc.length))
        for (let n = startLine.number; n <= endLine.number; n++) {
          const line = doc.line(n)
          builder.add(
            line.from,
            line.from,
            fencedLineDeco(n === startLine.number, n === endLine.number),
          )
        }
      },
    })
  }
  return builder.finish()
}

const fencedCodeBackground = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildFencedCodeDecos(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildFencedCodeDecos(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'tok-heading tok-heading-1' },
  { tag: t.heading2, class: 'tok-heading tok-heading-2' },
  { tag: t.heading3, class: 'tok-heading tok-heading-3' },
  { tag: t.heading4, class: 'tok-heading tok-heading-4' },
  { tag: t.heading5, class: 'tok-heading tok-heading-5' },
  { tag: t.heading6, class: 'tok-heading tok-heading-6' },
  { tag: t.strong, class: 'tok-strong' },
  { tag: t.emphasis, class: 'tok-emphasis' },
  { tag: t.strikethrough, class: 'tok-strikethrough' },
  { tag: t.link, class: 'tok-link' },
  { tag: t.url, class: 'tok-url' },
  { tag: t.monospace, class: 'tok-code' },
  { tag: t.contentSeparator, class: 'tok-hr' },
  { tag: t.quote, class: 'tok-quote' },
  { tag: t.list, class: 'tok-list' },
  { tag: t.processingInstruction, class: 'tok-marker' },
  { tag: t.meta, class: 'tok-marker' },
])

// --- in-document find (source mode) -----------------------------------------
// CM's built-in highlighter only paints while its search panel is open, and we
// never open that panel, so we roll our own decorations off the same search
// state (`getSearchQuery`) that the headless replace commands read.

function buildFindDecos(view: EditorView): DecorationSet {
  const query = getSearchQuery(view.state)
  const builder = new RangeSetBuilder<Decoration>()
  if (!query.valid) return builder.finish()
  const sel = view.state.selection.main
  for (const { from, to } of view.visibleRanges) {
    const cursor = query.getCursor(view.state, from, to)
    for (let it = cursor.next(); !it.done; it = cursor.next()) {
      const m = it.value
      const active = m.from === sel.from && m.to === sel.to
      builder.add(
        m.from,
        m.to,
        Decoration.mark({
          class: active ? 'cm-find-match cm-find-match-active' : 'cm-find-match',
        }),
      )
    }
  }
  return builder.finish()
}

const findHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildFindDecos(view)
    }
    update(u: ViewUpdate): void {
      const queryChanged = u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))
      if (u.docChanged || u.viewportChanged || u.selectionSet || queryChanged) {
        this.decorations = buildFindDecos(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

type CmRange = { from: number; to: number }

function cmQuery(input: FindQueryInput, replace = ''): SearchQuery {
  return new SearchQuery({
    search: input.text,
    caseSensitive: input.caseSensitive,
    regexp: input.regex,
    wholeWord: input.wholeWord,
    replace,
  })
}

function cmCollect(state: EditorState, query: SearchQuery): CmRange[] {
  const out: CmRange[] = []
  if (!query.valid) return out
  const cursor = query.getCursor(state)
  for (let it = cursor.next(); !it.done && out.length < MATCH_CAP; it = cursor.next()) {
    out.push({ from: it.value.from, to: it.value.to })
  }
  return out
}

function createCmFindEngine(view: EditorView): FindController {
  let lastInput: FindQueryInput | null = null
  let armed = false

  const activeIndex = (matches: CmRange[]): number => {
    const sel = view.state.selection.main
    return matches.findIndex((m) => m.from === sel.from && m.to === sel.to)
  }

  function buildResult(matches: CmRange[]): FindResult {
    const doc = view.state.doc
    const list: FindMatch[] = matches.map((m, i) => {
      const line = doc.lineAt(m.from)
      const col = m.from - line.from
      const end = Math.min(m.to - line.from, line.length)
      const hit = doc.sliceString(m.from, Math.min(m.to, line.to))
      const bs = Math.max(0, col - SNIPPET_PAD)
      const ae = Math.min(line.length, end + SNIPPET_PAD)
      let before = line.text.slice(bs, col)
      let after = line.text.slice(end, ae)
      if (bs > 0) before = '…' + before
      if (ae < line.length) after = after + '…'
      return { index: i, before, hit, after, line: line.number }
    })
    return {
      valid: true,
      total: matches.length,
      active: activeIndex(matches),
      capped: matches.length >= MATCH_CAP,
      matches: list,
    }
  }

  function selectAndScroll(m: CmRange): void {
    view.dispatch({
      selection: { anchor: m.from, head: m.to },
      effects: EditorView.scrollIntoView(m.from, { y: 'center' }),
      userEvent: 'select.find',
    })
  }

  function current(): FindResult {
    if (!armed || !lastInput) return EMPTY_RESULT
    const query = cmQuery(lastInput)
    if (!query.valid) return INVALID_RESULT
    return buildResult(cmCollect(view.state, query))
  }

  function move(dir: 1 | -1): FindResult {
    if (!armed || !lastInput) return current()
    const matches = cmCollect(view.state, cmQuery(lastInput))
    if (!matches.length) return buildResult(matches)
    let cur = activeIndex(matches)
    if (cur < 0) cur = dir > 0 ? -1 : 0
    const ni = (cur + dir + matches.length) % matches.length
    selectAndScroll(matches[ni])
    return buildResult(matches)
  }

  const setSearch = (query: SearchQuery): void => {
    view.dispatch({ effects: setSearchQuery.of(query) })
  }

  return {
    setQuery(input: FindQueryInput): FindResult {
      lastInput = input
      const isEmpty = input.text.length === 0
      const query = cmQuery(input)
      if (isEmpty || !query.valid) {
        armed = false
        setSearch(new SearchQuery({ search: '' }))
        return isEmpty ? EMPTY_RESULT : INVALID_RESULT
      }
      armed = true
      setSearch(query)
      const matches = cmCollect(view.state, query)
      if (matches.length) {
        const caret = view.state.selection.main.from
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
      const matches = cmCollect(view.state, cmQuery(lastInput))
      if (index < 0 || index >= matches.length) return buildResult(matches)
      selectAndScroll(matches[index])
      return buildResult(matches)
    },
    replace(replacement: string): FindResult {
      if (!armed || !lastInput) return current()
      setSearch(cmQuery(lastInput, replacement))
      cmReplaceNext(view)
      return current()
    },
    replaceAll(replacement: string): number {
      if (!armed || !lastInput) return 0
      const count = cmCollect(view.state, cmQuery(lastInput)).length
      setSearch(cmQuery(lastInput, replacement))
      cmReplaceAll(view)
      return count
    },
    selectedText(): string {
      const sel = view.state.selection.main
      return sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to)
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

export interface SourceViewOptions {
  parent: HTMLElement
  doc: string
  onUpdate?: (doc: string) => void
}

export interface SourceView {
  view: EditorView
  /** In-document find over the CodeMirror buffer (source mode). */
  find: FindController
  getValue(): string
  setValue(text: string): void
  focus(): void
  destroy(): void
  /** Try to undo a CM-side edit. Returns false when CM history is empty so the
   * caller can fall back to the editor's history (a unified undo). */
  tryUndo(): boolean
  /** Symmetrical redo. */
  tryRedo(): boolean
}

export function createSourceView(opts: SourceViewOptions): SourceView {
  let lastDoc = opts.doc

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown(),
        syntaxHighlighting(markdownHighlight),
        fencedCodeBackground,
        // `search()` initializes the search state so setSearchQuery + the
        // headless replace commands work; `findHighlighter` paints the matches
        // (CM's built-in highlighter only paints while its panel is open, which
        // we never open). No searchKeymap — Cmd/Ctrl+F routes through our own
        // command registry, not CM's panel.
        search(),
        findHighlighter,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const text = u.state.doc.toString()
          if (text === lastDoc) return
          lastDoc = text
          opts.onUpdate?.(text)
        }),
      ],
    }),
  })

  return {
    view,
    find: createCmFindEngine(view),
    getValue: () => view.state.doc.toString(),
    setValue: (text: string) => {
      lastDoc = text
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    tryUndo: () => (cmUndoDepth(view.state) === 0 ? false : cmUndo(view)),
    tryRedo: () => (cmRedoDepth(view.state) === 0 ? false : cmRedo(view)),
  }
}
