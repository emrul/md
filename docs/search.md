# In-document Find & Replace

**Status:** Design, not built. Targets the M3 "find/replace" line item (see `docs/design.md`). **Core / OSS feature** — mounts in core boot, not through the `md-pro` feature registry.

**Scope:** find (and replace) *within the active document*. This is **not** the project-wide search index — that's a separate, much larger effort sketched in [`docs/search-index-notes.md`](search-index-notes.md) (SQLite/FTS, a Go service, fsnotify). The two share the word "search" and nothing else: different lifetime (one open doc vs. a project), different substrate (in-memory ProseMirror/CodeMirror vs. a disk index), different UI. To keep the namespace clean:

- **In-document find** (this doc): `Cmd/Ctrl+F`, `Cmd/Ctrl+Alt+F`. No Go, no service, no index.
- **Project search** (future): `Cmd/Ctrl+Shift+F`. Deliberately left unclaimed here.

## The experience

A persistent button on the left gutter rail (above ToC) plus `Cmd/Ctrl+F`. Both open a small floating panel anchored under the button — same anchoring as the ToC panel, no OS popup window.

```
┌─────────────────────────────────────────┐
│ [Find ▾] [ query……………… ] Aa  W  .*  3/17 │   ← mode dropdown · query · options · counter
│ With:    [ replacement……  ]  Replace  All │   ← second row, only in Replace mode
├─────────────────────────────────────────┤
│ › 12  …the quick **brown** fox jumped…   │   ← results list: locator + context snippet,
│   48  a **brown**-bag session at noon…   │     match highlighted, current row marked (›)
│   91  unbrownable, not a real word but…  │     ~8–10 rows visible, scrolls beyond
│   …                                       │
└─────────────────────────────────────────┘
        ▲                              ▲▼
   click row = jump          ▲/▼ buttons = prev/next in document
```

Behaviours:

- **Open** (`Cmd/Ctrl+F`): focus the query input; if there's a selection, seed the query from it (and select the input text) — standard editor behaviour.
- **Live**: typing re-runs the query on a short debounce (exact interval TBD — there's no in-repo precedent; tune it by feel). All matches highlight in the document; the current match gets a stronger highlight and is scrolled into view.
- **Navigate**: `Enter` / `Shift+Enter` and the ▲/▼ buttons move to next/previous match in the document. `Cmd/Ctrl+G` / `Cmd/Ctrl+Shift+G` do the same and work even when focus is back in the editor (no need to reopen the panel).
- **Results list**: each match shows a locator + a context snippet with the hit highlighted. Clicking a row jumps to that match. Capped visible height (~8–10 rows); more matches scroll. The list mirrors the document highlights — current row stays in sync with the current match.
- **Click-away hides, state survives**: clicking into the document closes the panel but keeps the query, replacement, options, and mode. Reopening **re-runs** the query from scratch (cursor and content may have changed since) and restores the panel. The current match, where still valid, is re-selected; otherwise it falls to the nearest following match.
- **Close** (`Esc`): hide the panel, clear all match decorations, return focus to the editor at the current match position.

### Replace

The `[Find ▾]` control is a two-item dropdown — **Find** / **Replace** — so the same panel does both, and the second row only exists in Replace mode:

- **Find** mode: one input row.
- **Replace** mode: adds the `With:` row plus **Replace** (replace current match, then advance) and **All** (replace every match) buttons.

`Cmd/Ctrl+Alt+F` opens directly in Replace mode. Replace honours the same options (case / whole-word / regex) as find; with regex on, `$1`-style capture-group references are supported in the replacement.

### Options

Three toggles in the query row, all standard and supported by both engines:

- **Aa** — case-sensitive
- **W** — whole word
- **.\*** — regular expression

The raw-source view is the natural home for power-user regex work (already called out in `design.md`), but the toggles work in every mode.

**Invalid regex.** With the regex toggle on and live search, users will type transiently invalid patterns (`(`, `[a-`). The panel must never throw: catch the compile error, mark the query input invalid (red border + a small hint), show no active result (`0/0`), and disable navigation and Replace until the pattern compiles. Both engines expose validity — CodeMirror's [`SearchQuery.valid`](https://codemirror.net/docs/ref/#search.SearchQuery) and a guarded `new RegExp(…)` on the PM side ([`prosemirror-search`](https://github.com/ProseMirror/prosemirror-search)) — so the facade returns `valid: false` rather than raising.

## The line-number question

The user ask mentioned line numbers. The honest constraint: **line numbers only exist in source mode.** A ProseMirror document is a tree, not lines — wysiwyg/hybrid have no canonical line for a match, and reconstructing one by mapping back to the markdown is fragile (hidden syntax markers shift offsets, especially in wysiwyg).

**Resolution (recommended):**

- The **context snippet** is the primary, mode-independent locator — it's more useful than a bare line number anyway, and works identically in all three modes.
- A **match counter** (`3/17`) is always shown.
- In **source mode**, the snippet row is prefixed with the real line number (CodeMirror knows it for free).
- In **wysiwyg/hybrid**, the prefix is the **section** the match sits under (nearest enclosing heading), the rendered-mode analog of "where am I." This shares the ToC's heading-*collection* logic, but the match→enclosing-section mapping is **new** code — the ToC computes the *active* heading by scroll position, not "which heading contains arbitrary position X." *(Worth a thumbs-up before building; showing nothing there is the cheaper fallback.)*

## Architecture fit

### Markdown is source-of-truth — what find searches over

Find operates on the **active view**, not on a re-serialized markdown string:

- **source mode** → searches the markdown bytes directly (CodeMirror over the string). Matches the file exactly; line numbers and regex are native.
- **wysiwyg** → searches the *rendered* ProseMirror text. Syntax markers (`**`, `#`, …) aren't shown, so they aren't matched.
- **hybrid** → searches the mixed rendered/source surface currently visible. Hybrid wraps only **top-level paragraphs and headings** in source blocks (whose raw markdown text — markers included — is searchable); lists, tables, blockquotes, code, and math stay rendered (see [`docs/hybrid.md`](hybrid.md)). So marker-matching in hybrid is *partial* and depends on what's wrapped — **source mode is the only view where a search matches the markdown bytes exactly.**

This does **not** violate the source-of-truth rule: find never canonicalizes through the AST or mutates the doc except via normal, undoable Replace transactions. It's a read-and-decorate overlay.

### One facade, two engines (mirror undo/redo)

`ViewController` already abstracts CM-vs-PM for `undo`/`redo`. Find gets the same treatment: a `search` facade on `ViewController` that dispatches to whichever engine backs the current mode, and **re-targets on mode switch** (subscribe to `onModeChange`, re-run the active query against the new view). The UI talks only to this facade and never knows which engine is live.

The facade exchanges **plain data**, never ProseMirror nodes or CM ranges (keeps the TipTap quarantine intact):

```ts
interface SearchQueryInput { text: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean }
interface SearchMatch { index: number; snippet: string; line?: number; section?: string }
interface SearchResult { valid: boolean; total: number; active: number; matches: SearchMatch[] }

interface SearchView {                     // exposed on ViewController as `search`
  setQuery(q: SearchQueryInput): SearchResult
  next(): SearchResult
  prev(): SearchResult
  goto(index: number): SearchResult
  replace(replacement: string): SearchResult   // current match, then advance
  replaceAll(replacement: string): number      // count is the facade's job, not the engine's — see note
  clear(): void
}
```

> **`replaceAll` returns a count; the engines don't.** `prosemirror-search`'s `replaceAll` is a ProseMirror command — it returns command *success*, not how many matches changed ([discussion](https://discuss.prosemirror.net/t/get-number-of-replacements-after-replaceall/8921)). CodeMirror's is the same shape. So the facade **counts the matches itself** (iterate `SearchQuery.findNext` across the doc) *before* dispatching the replace-all, and returns that count.

### TipTap stays in `editor/`

- **PM side**: a thin TipTap extension wrapping [`prosemirror-search`](https://github.com/ProseMirror/prosemirror-search) (by the ProseMirror author; provides `SearchQuery`, a `search` plugin with match decorations, and `findNext`/`findPrev`/`replaceNext`/`replaceAll` — exports + replacement-template support to confirm against the installed version). Lives in `editor/search/`. Exposes commands + a query of the current match set as plain data. **Unverified pick** — chosen on reputation, not a spike; see the open question on decoration coexistence below.
- **source side**: extend `sourceView.ts` with search methods backed by `@codemirror/search` (`SearchQuery` + `SearchCursor`), reusing the existing decoration pattern in that file for highlights.

The `ui/` panel imports neither `@tiptap/*` nor `@codemirror/*` — only the `ViewController.search` facade.

### Command registry is the spine

Every verb registers centrally in `registerCommands`, like every other core verb — no deviation. The key is to **not** make the handlers depend on the find *UI*. Follow the `ExplorerState` precedent: a window-level `FindState` (`app/findState.ts`) holds the session (query, replacement, options, mode, open/closed, current index), is constructed before `registerCommands` (alongside `explorerState` at `bootEditor.ts:111`), and is injected the same way `explorer` is. Then:

- **Panel verbs flip state:** `find.open` → `findState.open()`, `find.replace` → `findState.setMode('replace')`, `find.close` → `findState.close()` — the same shape as `view.toggleExplorer` → `explorer.toggleOverlay()`.
- **Engine verbs delegate lazily through the active tab:** `find.next` → `findState.next()`, which reads `tm.active()?.viewController?.search` — the same `tm.active()`-at-execution-time pattern `edit.undo` and `withEditor` already use, so nothing needs an early reference.
- **`mountFind` (UI) mounts later and *subscribes*** to `findState.onChange` to show/hide and render results — exactly as `mountExplorer` subscribes to `explorerState`.

The boot-ordering problem dissolves: state exists before registration, UI subscribes after. (An earlier draft had `mountFind` self-register its verbs — that works, but needlessly bends the "all core verbs in `registerCommands`" convention when the `ExplorerState` split already solves it.)

| Command | Default key | Notes |
|---|---|---|
| `find.open` | `Cmd/Ctrl+F` | open panel in Find mode; seed from selection |
| `find.replace` | `Cmd/Ctrl+Alt+F` | open panel in Replace mode |
| `find.next` | `Cmd/Ctrl+G` | works with panel closed |
| `find.prev` | `Cmd/Ctrl+Shift+G` | works with panel closed |
| `find.replaceOne` | — | panel button (current match) |
| `find.replaceAll` | — | panel button |
| `find.close` | `Esc` | panel-local |

`Enter`/`Shift+Enter` for next/prev and `Esc` for close are handled panel-locally (focus is in an input); they dispatch the same verbs. The global keymap only fires on `Cmd/Ctrl` combos (see `commands/keymap.ts`), so plain typing into the inputs is unaffected. No registered command binds `Cmd/Ctrl+F` today (verified against the keymap), so we can claim it — with one caveat to check per-platform: the host webview may ship its own find-on-page (notably WebView2 on Windows) that intercepts `Ctrl+F` unless disabled. Confirm during build; don't assume it's free.

### UI surface

A DOM panel is the right call here — find is an in-content surface, which the architecture explicitly allows for DOM menus (alongside the bubble menu, slash menu, future command palette). It is **not** app chrome, so no native menu.

It registers on the gutter rail via the existing `RailItemSpec`/`mountGutterRail` API. Suggested **order: 5** (above ToC's 10 — placement is arbitrary, pick by feel). Unlike ToC — which only appears for long, multi-heading docs and conveniently hides itself in source mode — the Find button should be visible whenever a document is open, **in every mode**. (That's also a shift in the rail's character: today it's empty until a doc is long enough for ToC; with Find it's always populated when a doc is open.) Three current rail facts are prerequisites, to fix *before* turning Find on:

- **Anchor to the active view, not always `.ProseMirror`.** `mountGutterRail`'s `computeLeft` measures `.ProseMirror` (`gutterRail.ts:60`), which is `display:none` in source mode (`viewMode.ts:82`). ToC only gets away with that because it hides in source. An always-visible Find button means the rail must measure **whichever view is currently shown** — `.ProseMirror` in wysiwyg/hybrid, the CodeMirror scroller (`.cm-editor`) in source.
- **The rail doesn't reflow on a mode switch.** This is the part the prior draft glossed: `layout()` is driven by `tm.onChange`, `explorer.onChange`, and resize (`gutterRail.ts:127`), but a source toggle fires only `onAfterTabContentChange` (`tabManager.ts:131` → `refreshAll`), which the rail doesn't subscribe to — and `tm.onChange` (the active/tab-list path) does *not* fire on a mode switch. ToC survives because its own `refresh()` runs on the content path and hides it in source; an always-visible button has no such escape hatch. So the rail must also reflow on the content/mode path (subscribe to it, or have `refreshAll` call `rail.reposition()`). Combined with the anchor fix, this is more than "one small change."
- **The rail does *not* hide for read-only overlays.** `layout()` checks only `explorer.overlayOpen` (`gutterRail.ts:68`); the read-only diff overlay is owned by `ViewController` (`viewMode.ts:88`) and the rail knows nothing about it. So `mountFind` must subscribe to the active tab's `viewController.onOverlayChange` and explicitly hide itself + clear its decorations while an overlay is mounted (re-binding to the new controller on tab switch). Don't rely on the rail for this.

### Core, not pro; no Go

Find mounts in core boot (`bootEditor.ts`) right alongside `mountToc`, using the same `rail` instance — it does **not** go through `features.ts` (that's the `md-pro` overlay's mechanism). Entirely frontend: in-memory document only, no `FileService`/new service, no IPC, no persistence.

## Where the code goes

```
frontend/src
├── editor/
│   └── search/
│       ├── SearchHighlight.ts   TipTap ext over prosemirror-search (decorations + commands)
│       └── search.css           match / active-match highlight tokens
│   sourceView.ts                + search methods (@codemirror/search SearchQuery + SearchCursor)
│   (mode.ts                     untouched)
├── app/
│   findState.ts                 NEW. window-level session state (ExplorerState parity); injected into registerCommands
│   viewMode.ts                  + `search` facade on ViewController (PM⇄CM), re-targets on mode switch
├── ui/
│   └── find/
│       ├── index.ts             mountFind(): rail button + floating panel + results list
│       └── find.css
├── commands/
│   └── find.ts                  registers find.* verbs centrally (via registerCommands), against FindState
└── app/bootEditor.ts            mountFind(tm, explorer, host, rail) next to mountToc
```

New dependencies: `prosemirror-search`, `@codemirror/search`.

## State & lifecycle

- **Find session state** (query, replacement, mode, options, current match index) lives in the window-level `FindState` (`app/findState.ts`) — ephemeral, never persisted to session.json or preferences.toml. Whether it remembers a *separate* query per tab or holds one session re-bound on tab switch (like the explorer's single overlay state) is an open question; start with the simpler single-session model.
- **Open**: re-run the query against the active view (content/cursor may have moved). Re-select the prior match if still valid, else the nearest following match.
- **Close / click-away**: clear all decorations, keep the session state. The "remembered" query is what `find.next` (`Cmd/Ctrl+G`) uses with the panel closed.
- **Tab switch**: panel reflects the newly-active tab's session (or empties if it has none). Decorations belong to a tab's view and never leak across tabs.
- **Mode switch** (`Cmd/Ctrl+/` or the mode dropdown): `ViewController` tears down the old engine's decorations and re-runs the query on the new engine; the panel refreshes counts/snippets. Locator format flips (line number ⇄ section) accordingly.
- **Live edits while open**: a document change invalidates the match set; re-run debounced and update the list + counter. Replace transactions are normal undoable edits (one undo step per Replace; Replace-All is a single step).

## Decisions (the load-bearing ones)

- **Searches the active view, not a re-serialized string.** Find is read-and-decorate; what you search is what you see in the current mode. (Source-of-truth preserved — no AST canonicalization.)
- **One `ViewController.search` facade over two engines**, re-targeted on mode switch — the same seam as undo/redo. UI never touches an engine directly.
- **Facade exchanges plain data**, not PM/CM internals — TipTap quarantine holds.
- **Snippet is the primary locator**; line numbers only where they're real (source mode), section context as the rendered-mode analog.
- **All verbs through `commands/`**; DOM panel as an allowed in-content surface; rail item for the affordance.
- **Core feature**, core boot, no Go, no persistence.

## Open questions

- Rendered-mode locator: section/heading context, or just the snippet with no prefix? (Recommended: section context, reusing ToC heading detection.)
- Results-list cap: hard limit (e.g. "showing first 200 matches") for pathological docs, or just virtualize/scroll? Lean toward a soft cap with a "+N more" footer rather than silently truncating.
- Should `find.next`/`prev` with the panel closed re-open it, or just move + flash the match? (Browser behaviour: move silently. Recommended: move silently, show a tiny counter toast.)
- Seed-from-selection: only single-line selections, or any? (Recommended: only when the selection is short and single-line.)
- Replace in source vs. rendered modes: the same `With:` text replaces literal bytes in source mode but rendered text in wysiwyg — confirm that's acceptable (it's the same "what you see is what you replace" principle as find).
- PM search library (unverified): confirm `prosemirror-search`'s match decorations coexist with the hybrid decoration plugins (HybridReveal, SourceBlock NodeViews, fenced-code background) and that replacement templates (`$1`) + single-step Replace-All undo behave as assumed. If they conflict, weigh the community `tiptap-search-and-replace` extension. Needs a spike before commitment.

## Out of scope

- Project-wide / multi-file search — see [`docs/search-index-notes.md`](search-index-notes.md). `Cmd/Ctrl+Shift+F` is reserved for it.
- Search history / saved searches.
- Find across closed files or the file tree.
- Persisting the last query beyond the process lifetime.
