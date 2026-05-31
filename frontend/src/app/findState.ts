// Per-window state for in-document find. Lives in app/ (not ui/) so commands
// can mutate it and the panel can subscribe, mirroring ExplorerState. One
// instance is reused across every tab — the session (query, replacement,
// options, mode, open/closed) survives tab switches; decorations don't (they
// belong to a tab's view). Ephemeral: never persisted to session.json.
//
// FindState is the single source of truth for the query. The engines
// (ViewController.find) are stateless executors it drives at call time via
// `tm.active()?.viewController?.find` — the same lazy-through-the-active-tab
// pattern edit.undo uses. See ../../../md-pro/docs/find.md.

import type { TabManager } from './tabManager'
import {
  EMPTY_RESULT,
  type FindController,
  type FindQueryInput,
  type FindResult,
} from '../editor/find/types'

type Listener = () => void
export type FindMode = 'find' | 'replace'

export class FindState {
  private q: FindQueryInput = { text: '', caseSensitive: false, wholeWord: false, regex: false }
  private replacement = ''
  private _mode: FindMode = 'find'
  private _open = false
  private _result: FindResult = EMPTY_RESULT
  private listeners = new Set<Listener>()
  private focusListeners = new Set<Listener>()

  constructor(private readonly tm: TabManager) {}

  // --- read ----------------------------------------------------------------
  get isOpen(): boolean {
    return this._open
  }
  get mode(): FindMode {
    return this._mode
  }
  get text(): string {
    return this.q.text
  }
  get replacementText(): string {
    return this.replacement
  }
  get options(): { caseSensitive: boolean; wholeWord: boolean; regex: boolean } {
    return {
      caseSensitive: this.q.caseSensitive,
      wholeWord: this.q.wholeWord,
      regex: this.q.regex,
    }
  }
  get result(): FindResult {
    return this._result
  }
  hasText(): boolean {
    return this.q.text.length > 0
  }
  input(): FindQueryInput {
    return { ...this.q }
  }

  private engine(): FindController | null {
    return this.tm.active()?.viewController?.find ?? null
  }

  // --- panel verbs (flip state) --------------------------------------------
  open(mode: FindMode = 'find'): void {
    this._open = true
    this._mode = mode
    if (this.hasText()) this.runQuery()
    else this.notify()
    // Always pull focus to the query input, even when re-invoked while open.
    this.requestFocus()
  }
  close(): void {
    if (!this._open) return
    this._open = false
    this.engine()?.clear()
    this._result = EMPTY_RESULT
    this.notify()
  }
  setMode(mode: FindMode): void {
    if (this._mode === mode) return
    this._mode = mode
    this.notify()
  }

  // --- query editing -------------------------------------------------------
  /** Set the query text without running it — used to seed Open from the
   * selection before the panel opens (open() runs it). */
  seed(text: string): void {
    this.q.text = text
  }
  setText(text: string): void {
    if (this.q.text === text) return
    this.q.text = text
    this.runQuery()
  }
  setReplacement(text: string): void {
    this.replacement = text
  }
  toggleOption(key: 'caseSensitive' | 'wholeWord' | 'regex'): void {
    this.q[key] = !this.q[key]
    this.runQuery()
  }

  /** Apply the current query to the active engine from scratch (highlights +
   * jump to the first match). */
  runQuery(): void {
    const e = this.engine()
    this._result = e ? e.setQuery(this.input()) : EMPTY_RESULT
    this.notify()
  }

  /** Recompute counts/snippets for the live query without moving the
   * selection — for live document edits while the panel is open. */
  refresh(): void {
    const e = this.engine()
    if (this._open && e && this.hasText() && e.hasQuery()) {
      this._result = e.current()
      this.notify()
    }
  }

  /** Re-apply the query to the (now-active) engine after a mode or tab switch,
   * where the previous engine's highlights were cleared. */
  reTarget(): void {
    if (!this._open) return
    const e = this.engine()
    this._result = e && this.hasText() ? e.setQuery(this.input()) : EMPTY_RESULT
    this.notify()
  }

  // --- navigation / replace (delegate through the active tab) --------------
  next(): void {
    const e = this.engine()
    if (!e || !this.hasText()) return
    // Closed-panel Cmd/Ctrl+G: arm first (jump to first hit), then advance on
    // subsequent presses. `hasQuery()` tells the two apart.
    this._result = e.hasQuery() ? e.next() : e.setQuery(this.input())
    this.notify()
  }
  prev(): void {
    const e = this.engine()
    if (!e || !this.hasText()) return
    this._result = e.hasQuery() ? e.prev() : e.setQuery(this.input())
    this.notify()
  }
  goto(index: number): void {
    const e = this.engine()
    if (!e) return
    this._result = e.goto(index)
    this.notify()
  }
  replaceOne(): void {
    const e = this.engine()
    if (!e || !this.hasText()) return
    this._result = e.replace(this.replacement)
    this.notify()
  }
  replaceAll(): number {
    const e = this.engine()
    if (!e || !this.hasText()) return 0
    const count = e.replaceAll(this.replacement)
    this._result = e.current()
    this.notify()
    return count
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  /** Fires when focus should move to the query input (panel open / re-open). */
  onFocusRequest(fn: Listener): () => void {
    this.focusListeners.add(fn)
    return () => this.focusListeners.delete(fn)
  }
  private requestFocus(): void {
    for (const fn of this.focusListeners) fn()
  }
  private notify(): void {
    for (const fn of this.listeners) fn()
  }
}
