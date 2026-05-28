# Hot exit (unsaved-changes persistence) plan

M4 polish. Direction settled with the user in a design session on 2026-05-28; this doc captures the decisions and the implementation order. Sequel to session restore (shipped) — this extends the *same* JSON session, no new datastore.

## Goal

Quitting the app never shows a save/discard popup. Any buffer with unsaved changes — a new **Untitled** document with text, or an edited file — survives app close (and crash), and comes back on next launch still marked **dirty**. The user picks up exactly where they left off and decides when to actually write to disk.

This is "hot exit" (VS Code's term). Two cases:

1. **Untitled draft** — a new doc with typed content but no file yet. Persisted with reference to its tab + window.
2. **Dirty file** — an existing file with unsaved edits. Persisted with its absolute path and a content hash of the buffer's base.

On relaunch, if we restore the session, we restore both and re-flag them dirty.

**Deliberate close still prompts.** The no-popup behaviour applies to *app quit* only. Closing a tab or a window is a deliberate act on those buffers — it prompts, and discarding deletes the draft(s). The asymmetry is intentional: quitting means "I'll come back," closing means "I'm done with this." Both the dirty decision and the prompt are **frontend-driven** (the frontend is the only authority on `tab.modified`); see [Window close](#window-close-frontend-driven).

### What this is *not*

Not autosave-over-your-file. The markdown-source-of-truth rule holds: the user's file on disk is **never** written without an explicit save. Drafts are a side cache in app config; the real file is untouched until the user saves.

## What already exists (so this is an extension, not new plumbing)

- `SessionService` already does debounced (400ms), atomic (temp+rename) writes and carries a `CleanShutdown` crash flag (`sessionservice.go`).
- A **clean** quit already restores every window silently; only a crash prompts (`startupSpawn`, `windowservice.go:160`). Drafts ride this existing path — no new restore trigger.
- `Tab` carries an `id`, a `modified` flag, and `getCurrentMarkdown()` (`app/tab.ts`); every keystroke reaches the reporter via `onUpdate → setModified(true) → tab.notify() → tm.notify()` (`tabManager.ts:108,189`).
- The structural reporter (`installSessionReporting`, `bootEditor.ts:162`) persists window/tab structure; **today it filters to file-backed paths only** (`bootEditor.ts:166`) — it *will* persist every tab (incl. untitled) after the payload reshape below.
- `handleWindowClosing` distinguishes a user close from an app-shutdown close via the `shuttingDown` flag (`sessionservice.go:230`) — reused below.
- Wails' `Close()` re-emits `WindowClosing` (`webview_window.go:1076`); window emissions reach **all** renderers, so consumers filter by sender (`ifMine`, `services/tabs.ts:61`). Both facts shape the window-close design.

## Core model: drafts are self-describing; session.json carries structure only

The earlier draft of this plan kept a `DraftRef` inside `session.json` pointing at a draft file, and relied on the structural reporter having already persisted a tab's path. Neither holds across a crash in the gap between two writes, or for a tab edited before the ~300ms structural debounce lands — so a recovered draft could lose its path. The fix removes the cross-reference:

- **`session.json`** persists only window geometry + the ordered tab list (`{id, path}`) + active tab + explorer. No draft info. `SaveWindowContent` can replace the tab list wholesale (frontend owns order/path/active; **dirtiness lives entirely in draft files**).
- **Each draft is a self-describing artifact**: `<configHome>/MarkdownMD/drafts/<windowID>/<tabID>.json` = `{ "path": "...", "baseHash": "...", "content": "..." }`, written atomically (temp+rename). It needs nothing from `session.json` to be recovered — `path` (empty ⇒ untitled), `baseHash` (empty ⇒ untitled), and the full buffer `content` are all in the one file written in one atomic op.

Trade-off accepted: a draft is a tiny JSON envelope rather than a hand-openable `.md`. In exchange there is **no two-file / two-write consistency to lose**, the path always survives a crash, and the merge logic disappears.

Why per-window subdirs: `tabIdSeq` is a per-renderer counter (`tabManager.ts:31`), so two windows can mint the same `tab-<ts36>-<seq>` in the same millisecond. The window subdir guarantees uniqueness and makes per-window cleanup a single `RemoveAll`.

## Wire shapes

### Persisted / save direction (identical shape)

```go
type WindowSession struct {
    ID        string          `json:"id"`
    // geometry … (unchanged)
    Tabs      []TabRef        `json:"tabs"`      // ordered; replaces []string
    ActiveTab string          `json:"activeTab"` // now a tab id, not a path
    Explorer  ExplorerSession `json:"explorer"`
}
type TabRef struct {
    ID   string `json:"id"`
    Path string `json:"path,omitempty"` // "" => untitled
}
// WindowContent (the SaveWindowContent arg) uses the same TabRef list + ActiveTab + Explorer.
```

### Restore direction — content inline, no frontend disk read

```go
type RestoreWindow struct {
    Tabs      []RestoreTab    `json:"tabs"`
    ActiveTab string          `json:"activeTab"`
    Explorer  ExplorerSession `json:"explorer"`
}
type RestoreTab struct {
    ID            string `json:"id"`
    Path          string `json:"path"`
    Dirty         bool   `json:"dirty"`
    Content       string `json:"content"`       // FULL draft markdown ("" when clean)
    BaseHash      string `json:"baseHash"`       // echoes the draft's baseHash so the tab can re-stamp it
    ChangedOnDisk bool   `json:"changedOnDisk"` // file present, re-hash ≠ baseHash
    MissingOnDisk bool   `json:"missingOnDisk"` // file-backed but path gone
}
```

`GetRestoreWindow` reads the window's draft files, computes `ChangedOnDisk`/`MissingOnDisk` Go-side (re-hash/stat), and returns the full `content` so the frontend loads dirty tabs **directly** — it never reads disk for a dirty tab (which also makes the deleted-file case free).

## Hashing — base is the *loaded* content

`baseHash` detects external modification on relaunch, so it hashes **the content the buffer diverged from** — the markdown loaded at open, refreshed after each save — **not** disk-at-first-edit (which would be the external version if the file changed while the tab sat open-but-clean).

- The frontend stamps `tab.baseHash` from the loaded markdown at open (`openPath`/`openFile`/`applyToTab`) and after each save (`files.ts:172,186`, `tabs.ts:176,181`); untitled tabs have none.
- A Go helper `HashContent(s) string` does the hashing (no JS hash dep; one definition). `SaveDraft` carries `tab.baseHash`; Go writes it into the draft JSON.
- Algorithm: **`github.com/cespare/xxhash/v2`** — pure-Go, **no cgo**, so it doesn't reintroduce the cross-compile problem that ruled out SQLite.

## The dirty bit is the trigger

Persist a draft for a tab **iff `tab.modified === true`** — covers untitled-with-text (no `baseHash`) and edited-file (with `baseHash`). An empty Untitled placeholder is `modified === false` and never persisted (matches `isEmptyUntitled`, `files.ts:24`).

### Untitled tabs: structural vs draft

The same modified-gate governs the **structural** tab list, to avoid restoring blank placeholders. `SaveWindowContent`'s `TabRef` list includes:
- all **file-backed** tabs (worth restoring even when clean), and
- **untitled** tabs only when `modified` (i.e. they have content and therefore a draft).

A clean empty untitled tab appears in neither the tab list nor the drafts. Defensively, `prepareStartup` also drops any restored `TabRef` that is untitled (`path == ""`) **and** has no draft — so a stale blank placeholder can never resurrect. If dropping leaves a window with zero tabs, restore falls back to a fresh Untitled (existing behaviour, `bootEditor.ts:141`).

## Lifecycle

**First-dirty is written immediately; later edits debounced.** On clean→dirty the per-tab reporter calls `SaveDraft` right away (not debounced); subsequent edits coalesce on a ~500ms debounce. "Immediate" ≠ synchronous, though — `SaveDraft` is an async IPC, so the precise guarantee is: the work is durable **once that first `SaveDraft` reaches Go and the file is written**. This shrinks the first-edit loss window from a full debounce interval to a single in-flight IPC; a hard kill *within* that IPC can still lose the first edit, which the frontend cannot prevent. The frontend tracks the pending first-dirty promise so graceful close/flush can **await** it (a normal quit or window-close never drops it).

**Clear** on three explicit paths (not just the reporter's `modified`→false signal):
- **Save** (`modified` true→false) → `ClearDraft(windowID, tabID)`.
- **Tab close / discard** → closing destroys the tab *without* flipping `modified`, so the reporter never fires. `closeTab` (`services/tabs.ts:18`) must **`await ClearDraft` before `tm.closeTab(id)`**, after a confirmed `confirmDiscard`.
- **Window close discard** → folded into `CloseWindow(id, discardDrafts=true)` (below).

**Cadence and crash model (honest).** Crash-safety comes from the continuous pushes (immediate first-dirty + ~500ms debounce), **not** a quit-time flush: Go's `shutdown()` (`sessionservice.go:256`) runs on the main thread and can't pull the frontend's pending content. The frontend also flushes pending debounces — and awaits any in-flight `SaveDraft` — on `blur` / `visibilitychange`→hidden and on the close-hook events. **Residual worst case:** a hard kill mid-keystroke loses at most the last debounce window (or, for the very first edit, the single in-flight IPC) — same class of guarantee as the existing 400ms geometry debounce.

**Restore** (`restoreWindowState`, `bootEditor.ts:138`) — per `RestoreTab`: not dirty → open from disk (today's behaviour); dirty → create the tab, load `Content` directly, `setModified(true)`, and raise `missingOnDisk` / changed markers as flagged. Restored tabs are created **with their persisted id** (`newTab` gains an optional `id`), so the draft file already matches and `ActiveTab` resolves directly — no re-id, no map, no orphan.

## Startup recovery — order matters, readable drafts are never quarantined

Recovery runs **inside `prepareStartup`, in this order**, because the current "drop windows with no surviving file tabs" filter (`sessionservice.go:120-128`) would otherwise discard a window whose only evidence is a draft:

1. Load `st.Windows`.
2. **Attach drafts to loaded windows.** Scan `drafts/`. For each `<windowID>/<tabID>.json` whose `windowID` is a loaded window: ensure a tab — update the matching `TabRef` if present, else **synthesize one from the draft's self-described `path`** (so a file-backed path survives even when the structural write never landed). Untitled drafts synthesize a `path:""` tab.
3. **Synthesize windows for orphan-windowID drafts.** A draft whose `windowID` is *not* among the loaded windows is almost always a window whose debounced session write never landed before a crash — `registerWindow` only *schedules* persistence (`sessionservice.go:212`). Because the draft is self-describing, create a restorable window (default geometry, **reusing the draft's `windowID`** so paths still match) populated from that dir's drafts. Do **not** quarantine readable drafts — that would throw away the user's only copy of their work, the exact thing hot exit exists to prevent.
4. **Then apply the survival filter** — a window with only draft-backed tabs now counts as restorable; a clean untitled `TabRef` with no draft is dropped (see [Untitled reconciliation](#untitled-tabs-structural-vs-draft)).
5. Only a draft file that **fails to parse** (corruption) is moved to `drafts/.orphans/` — quarantine-only, no auto-prune, no hard-delete (v1 has no recovery UI). Readable drafts never land here.

The only automatic deletions are explicit `ClearDraft` / window-discard / `discardAll` ("Start Fresh" → `RemoveAll` every `drafts/<windowID>`).

## Window close (frontend-driven)

A native close (red button / ⌘W) today just drops the window via the `handleWindowClosing` listener — no prompt — and Go can't reliably judge dirtiness (a just-typed edit may not be on disk yet). So the decision is delegated to the frontend.

`RegisterHook` callbacks run **before** listeners and abort them if one calls `event.Cancel()` (`webview_window.go:836-852`); the built-in close is a listener (`:298`). Register a `WindowClosing` **hook** per window:

- `shuttingDown` (app quit / hot exit) → emit `session:flush`; do **not** cancel; close proceeds, drafts retained.
- the window id is in an internal **approved-close set** → remove it and do **not** cancel (this is a programmatic `CloseWindow` re-entry; let it through — required because `Close()` re-emits `WindowClosing`).
- otherwise (deliberate close) → `event.Cancel()`, emit `window:requestClose` (with sender = window name).

Frontend `window:requestClose` handler — **filtered by `Window.Name()` like `ifMine`** (`tabs.ts:61`), since emissions hit all renderers — flushes pending drafts, then checks `tm.tabs.some(t => t.modified)`:
- none dirty → `CloseWindow(id, discardDrafts=false)`.
- dirty → one consolidated `confirmDialog` ("Discard N unsaved document(s)?"). Discard → `CloseWindow(id, discardDrafts=true)`. Cancel → leave open.

`CloseWindow(id, discardDrafts)` (bound, on `WindowService`): if `discardDrafts`, `RemoveAll(drafts/<id>)`; add `id` to the approved-close set; call the window's `Close()`. The hook then sees the approval, lets the close through, and the existing `handleWindowClosing` listener drops the window from the session.

## Conflict & missing file

Both surface at restore for a dirty *file-backed* tab; content always wins, with a marker:
- **`ChangedOnDisk`** (file present, hash differs) → restore the draft, raise a "changed on disk" marker (reusing the `•` dirty cue, `app/title.ts:13`). Saving overwrites disk; the marker is the warning.
- **`MissingOnDisk`** (path gone) → restore the draft, keep the path only as a hint, set `tab.missingOnDisk`. Since `saveFile` writes any non-null `filePath` directly (`files.ts:169`), it must check this flag and route the first save through `saveFileAs` (prefilled with the hint) instead of silently recreating the file. Clear on successful save.

## Go API

```go
// Bound:
func (s *SessionService) SaveWindowContent(id string, c WindowContent) error              // structural; wholesale tab-list replace
func (s *SessionService) GetRestoreWindow(id string) (RestoreWindow, error)               // inline content + Changed/Missing flags
func (s *SessionService) SaveDraft(windowID, tabID, path, baseHash, content string) error // writes self-describing <win>/<tab>.json
func (s *SessionService) ClearDraft(windowID, tabID string) error
func (s *SessionService) HashContent(content string) (string, error)                      // xxhash
func (w *WindowService)  CloseWindow(id string, discardDrafts bool) error                 // approved-close + optional RemoveAll

// Internal: atomic draft write/delete, prepareStartup recovery (attach → survive → quarantine),
//   discardAll RemoveAll's every drafts/<windowID>, WindowClosing hook + approved-close set.
```

## Frontend wiring

- **services/session.ts** — wrap `SaveDraft`/`ClearDraft`/`HashContent`/`GetRestoreWindow`; reshape the save payload to `WindowContent{ Tabs: TabRef[], activeTab: id, explorer }` — file-backed tabs always, untitled tabs only when `modified`.
- **Per-tab reporter** (`onTabCreated`) — on clean→dirty `SaveDraft` immediately; while dirty, debounced (~500ms) `SaveDraft` deduped on content hash; on `modified`→false `ClearDraft`.
- **Base hash** — stamp `tab.baseHash` via `HashContent` at open and after each save.
- **Flush** — on `blur` / `visibilitychange`→hidden and on `session:flush`.
- **Window close** — `window:requestClose` handler (sender-filtered) → flush → dirty check → `confirmDialog` → `CloseWindow(id, discard)`.
- **Tab close** — `closeTab` awaits `ClearDraft` before `tm.closeTab`.
- **Restore / save** — `restoreWindowState` consumes `RestoreWindow`, `newTab({id})`, loads `Content` directly, **re-stamps `tab.baseHash` from `RestoreTab.BaseHash`** (so the next edit's draft keeps a valid base for conflict detection), sets markers; `saveFile` routes through `saveFileAs` when `tab.missingOnDisk`.

## Edge cases

- **Empty Untitled** — never persisted (no draft *and* no structural `TabRef`); `prepareStartup` also drops any restored untitled-with-no-draft.
- **Untitled → Saved** — draft cleared; becomes an ordinary file tab.
- **Type then immediately close window** — handled: prompt is frontend-driven off live `tab.modified`.
- **Crash before the window's own session write lands** — the draft's `windowID` isn't in `session.json` yet; recovery **synthesizes a window** (reusing the id) from the self-describing draft rather than quarantining it.
- **Crash between draft write and structural write** — draft is self-describing (path + content), recovered regardless of session state.
- **Hard kill within the first in-flight `SaveDraft`** — the documented residual: the first edit can be lost before it reaches Go. Everything after the first write lands is durable.
- **Dirty file deleted externally** — restored from draft, `missingOnDisk` set, first save prompts Save As.
- **Programmatic close re-entry** — handled by the approved-close set (`Close()` re-emits `WindowClosing`).
- **Crash prompt** — "Restore" brings drafts; "Start Fresh" → `discardAll` removes all draft dirs.
- **Two windows, identical untitled tab ids** — per-window subdirs prevent collision.
- **Upgrade migration** — none. `Tabs []string` → `[]TabRef` makes an old `session.json` fail to parse; `load()` treats that as empty clean session (`sessionservice.go:355`). One-time loss on first launch after upgrade — accepted (single user).

## Implementation order

1. **Go store + drafts.** Structs w/ JSON tags (incl. `RestoreTab.BaseHash`); self-describing draft read/write/delete (atomic); `SaveDraft`/`ClearDraft`/`HashContent`; `GetRestoreWindow` content + `baseHash` + `ChangedOnDisk`/`MissingOnDisk`; wholesale-replace `SaveWindowContent`; `baseHash` via `cespare/xxhash/v2`; **`prepareStartup` recovery order** (attach drafts → synthesize windows for orphan windowIDs → survival filter, dropping untitled-with-no-draft → corrupt-only quarantine) + window-survival change; `discardAll` removes draft dirs. Tests: orphan-with-restorable-window reattached (path preserved); orphan windowID ⇒ window synthesized, not quarantined; hash mismatch ⇒ `ChangedOnDisk`; recovery precedes survival filter.
2. **Window-close hook + `CloseWindow`.** Hook: `shuttingDown` ⇒ flush+proceed; approved-close ⇒ proceed; else `Cancel()` + emit sender-stamped `window:requestClose`. `CloseWindow(id, discardDrafts)` with approved-close set.
3. **Bindings + services/session.ts.** Regenerate; reshape payloads; wrap methods.
4. **Reporters + base hash + flush.** Immediate first-dirty + debounced `SaveDraft` (track the first-dirty promise for flush to await); `ClearDraft` on save and (awaited) on tab-close; `tab.baseHash` stamping; structural payload gates untitled tabs by `modified`; blur/visibility/`session:flush` flush.
5. **Restore.** `RestoreWindow`-aware `restoreWindowState`; `newTab({id})`; direct content load; markers.
6. **Conflict & missing markers + save routing.** `tab.missingOnDisk` → `saveFileAs`; "changed on disk" cue.
7. **Verify** (manual, per `docs/architecture.md`):
   - Untitled with text → quit → relaunch → restored dirty.
   - Edit file → quit → relaunch → restored dirty; save writes through.
   - Edit file → modify externally → relaunch → restored dirty + "changed on disk".
   - Edit file → delete externally → relaunch → restored dirty + Save As on first save.
   - Type one char → ⌘W → prompt appears (not lost to the debounce).
   - Type one char, let the first `SaveDraft` land → hard-kill → relaunch → draft recovered. (A kill inside that first in-flight IPC is the documented residual.)
   - New window, type in an untitled tab, hard-kill **before** the window's session write lands → relaunch → window **synthesized** from the draft (content + id preserved), not quarantined.
   - File-backed tab edited before any structural write, hard-kill → relaunch → content **and path** recovered from the self-describing draft.
   - Restore a dirty file tab, edit again, quit, relaunch → still detects external changes (baseHash survived the round-trip).
   - Close dirty tab → prompt; discard → draft gone. Close dirty window → one prompt; Cancel keeps it; Discard removes its drafts; window actually closes (approved-close works).
   - Two windows editing untitled drafts → no file collision; requestClose only acted on by the right window.

## References

- Session service (`:120-128` survival filter, `:196` tab-list write, `:225` close, `:230` shuttingDown, `:256` shutdown, `:355` parse-fallback): `app/sessionservice.go`.
- Clean-quit restore vs crash prompt; native dialog: `windowservice.go:154-167`, `:172`.
- Close hook vs listener + `Cancel()`; `Close()` re-emits `WindowClosing`: `webview_window.go:298,836-852,1076`; `webview_window_darwin.m:312`.
- Window emissions reach all renderers → sender filtering: `services/tabs.ts:61`.
- Tab model + id generation: `app/tab.ts`; `app/tabManager.ts:31`. Edit→notify chain: `tabManager.ts:108,125,189`.
- Reporter / restore: `bootEditor.ts:162,166` / `:138`.
- Save points + tab close/discard + missing-file routing: `files.ts:24,169,172,186`; `services/tabs.ts:7,18,170-184`.
