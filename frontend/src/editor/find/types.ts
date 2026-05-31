// Plain-data contract for in-document find. Deliberately free of any TipTap or
// CodeMirror import so `ui/` can hold these types without breaching the editor
// quarantine — the panel talks to a `FindController`, never to an engine.
//
// Naming note: this is the *in-document* feature ("find"). Project-wide search
// (the SQLite/FTS index, Cmd/Ctrl+Shift+F) is a separate future feature and
// owns the "search" namespace — see ../../../md-pro/docs/find.md.

/** The query the user typed plus the three option toggles. */
export interface FindQueryInput {
  text: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/**
 * One match, pre-split for the results list so the panel never does offset
 * math: render `before` + <mark>`hit`</mark> + `after`. `before`/`after` may be
 * elided with a leading/trailing ellipsis. The locator is `line` (source mode,
 * 1-based) or `section` (rendered modes, nearest enclosing heading) — at most
 * one is set, and either may be absent.
 */
export interface FindMatch {
  index: number
  before: string
  hit: string
  after: string
  line?: number
  section?: string
}

/**
 * The result of any find operation. `active` is the 0-based index of the
 * current match (or -1 when none is current). `total` counts matches actually
 * collected; when `capped` is true there may be more in the document than the
 * `matches` list holds (see the per-engine MATCH_CAP). `valid` is false only
 * for a genuinely invalid query (e.g. a half-typed regex) — an empty query or
 * a zero-hit query is still `valid: true`.
 */
export interface FindResult {
  valid: boolean
  total: number
  active: number
  capped: boolean
  matches: FindMatch[]
}

/**
 * The verbs a single view's find engine exposes. Both engines (ProseMirror via
 * prosemirror-search, CodeMirror via @codemirror/search) implement this, and
 * `ViewController.find` is a facade of the same shape that forwards to whichever
 * engine backs the active mode. Every method returns plain data — no PM nodes,
 * no CM ranges.
 */
export interface FindController {
  /** Set/replace the active query, highlight all matches, and move the current
   * match to the first hit at/after the caret (scrolling it into view). */
  setQuery(q: FindQueryInput): FindResult
  /** Advance / retreat the current match (wraps), scrolling it into view. */
  next(): FindResult
  prev(): FindResult
  /** Jump to the match at `index` in the results list. */
  goto(index: number): FindResult
  /** Replace the current match, then advance to the next. */
  replace(replacement: string): FindResult
  /** Replace every match in one undoable step; returns the count replaced
   * (the engine counts itself — the underlying commands report only success). */
  replaceAll(replacement: string): number
  /** The active view's current selection text, used to seed Open. */
  selectedText(): string
  /** Recompute counts/snippets for the *current* query without moving the
   * selection — used after live document edits. */
  current(): FindResult
  /** True while a valid, non-empty query is armed (drives Cmd/Ctrl+G when the
   * panel is closed: re-arm vs. advance). */
  hasQuery(): boolean
  /** Drop all highlights and forget the query. Session state lives in FindState,
   * not here, so this is safe to call on close / mode switch. */
  clear(): void
}

/** Benign empty result (no query, or no engine) — never renders as an error. */
export const EMPTY_RESULT: FindResult = {
  valid: true,
  total: 0,
  active: -1,
  capped: false,
  matches: [],
}

/** Empty result flagged invalid — used for an un-compilable regex. */
export const INVALID_RESULT: FindResult = {
  valid: false,
  total: 0,
  active: -1,
  capped: false,
  matches: [],
}

/** Soft cap on matches collected per query. Beyond this the results list shows
 * a "+N more" footer; highlighting still covers the visible viewport. */
export const MATCH_CAP = 500

/** Characters of context kept on each side of a hit in a results snippet. */
export const SNIPPET_PAD = 32
