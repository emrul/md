# Change History — the first pro feature

> Implementation plan. Companion to [`pro-features.md`](pro-features.md)
> (open-core seam), [`hybrid.md`](hybrid.md) (editor modes / decorations), and
> [`architecture.md`](architecture.md) (command registry, markdown-as-source).

## Context

MarkdownMD is open-core: the public OSS repo (`md`) builds standalone, and paid
features live in the private sibling module `md-pro` (`../md-pro/`), linked only
in `-tags pro` / `PRO=1` builds. This is the first real pro feature exercising
that seam beyond the `aiAssist` proof-of-concept.

**The feature.** For a git-tracked document, surface its git change history
(reverse-chronological) — each commit's **short hash / message / relative age**
plus a **diff action**, with a top row for **uncommitted changes** when the
working copy differs from HEAD or the buffer has unsaved edits. The diff action
opens a **full-surface, read-only "track-changes" view** comparing the **current
document against that version**, rendered Word-style: red strikethrough for
deletions, blue for insertions, hover-to-show-original on replacements.

**Entry point — a left gutter rail item (not an in-document widget).** Introduce a
small **editor gutter rail** in OSS: a vertical stack of icon buttons parked
left-of-content using ToC's measured `.ProseMirror`-left positioning. The
Table-of-Contents icon becomes the first rail item; **Change History is a second
rail item with its own visibility rules**, stacked below ToC when ToC is visible
and taking the top slot when ToC is hidden. Crucially it is **not positionally
dependent on ToC** (ToC only shows for long docs with 3+ headings, and hides in
source mode) — the rail owns slot assignment so each item shows/hides
independently. Clicking the item opens a floating history panel.

This dissolves a cluster of problems an in-document table would create: no
ProseMirror widget decoration, no caret/selection interaction, no
`contenteditable` gymnastics, no per-keystroke recompute, no mode-gating of a doc
node, and no "below the first heading" anchoring (works for files with no
headings). It reads as **app chrome, not document content** — which is what this
feature is — and nothing touches source blocks or serialization.

**Product semantics (intentional v1 scope).** The row action means *"compare the
current document to this version"* — **not** "show this commit's own patch." The
icon tooltip / menu label says so explicitly, because a diff icon on a commit row
is easily misread as "show this commit's patch." A **read-only** view is the
deliberate v1 boundary: **"restore this version"** and **"copy the old version"**
are expected follow-ups, called out under non-v1 gaps.

---

## Decisions (locked with the user)

- **History surface:** a **gutter-rail item** (its own visibility, stacked with
  ToC) opening a floating panel — modeled on `frontend/src/ui/toc/index.ts`.
  Columns: **short hash / commit message / relative age / diff icon**. Relative
  age (e.g. "2d") with full date+time on hover. Capped-height scroll container
  rendering all rows up to the Go `-n` cap (200) — no windowed virtualization.
- **Diff surface:** full-surface read-only view, **owned by the `ViewController`**
  via a generic read-only-overlay API (not bolted on beside it). Because it's
  VC-managed, the diff can be opened even from source mode.
- **Gating:** **hidden rail** — the rail item is only registered/shown when the
  license grants `change-history` (unlicensed users see nothing, no teaser). The
  in-panel empty states cover *data* absence (non-git / untracked / unborn-HEAD /
  no `git`), **not** licensing. `showDiff` stays defensive anyway (entitlement
  re-check + `showUpsell`), and the Go service re-checks (fail closed).
- **Entry points (v1):** (1) the rail item + panel (primary); (2)
  `pro.changeHistory.toggle` command (palette + keybinding). The explorer
  "Show File History" context-menu item is **deferred** (see below) — no dead
  OSS menu item and no pro command string in OSS Go.
- **Fidelity:** structure-aware — inline word-diff for prose & list items;
  whole-block add/remove for tables / code / structural moves.
- **Diff engine:** markdown-aware, in-module, behind a `DiffEngine` interface.
  **Not** sem/difftastic→WASM (sem is code-entity/section-level, native git2 +
  tree-sitter, no WASM path; libgit2→wasm unsolved). **Our code owns** markdown
  block parsing (reusing the in-app markdown-it tokenizer), block/item pairing, and
  DOM rendering; the low-level token diff uses **jsdiff** (`diff`, MIT) — its
  Myers-based `diffArrays` / `diffWordsWithSpace` with custom comparators +
  `Intl.Segmenter` — rather than a hand-rolled LCS (better output, fewer algorithm
  bugs, no quadratic foot-guns). `diff` lives in the OSS `frontend/package.json`
  (so the pro bundle resolves it) but is generic and **tree-shakes out of the OSS
  bundle** (the pro module isn't imported there). No Rust/WASM toolchain; the
  interface leaves room for a future engine.
- **Git access:** shell out to the system **`git` binary** (`git log --follow`)
  so history **follows renames** — go-git has no `--follow` and a slow path
  filter ([go-git#137](https://github.com/go-git/go-git/issues/137)). Infrequent,
  user-initiated op → a process spawn is fine (unlike the explorer's hot-path
  `.git` reads). Degrade gracefully when `git` is absent. No new Go deps.
- **Preference storage:** a generic, add-only `FeatureSettings map[string]string`
  bag on the OSS `Preferences` struct (no pro feature names leak into OSS).

---

## Architecture overview

```
md (OSS)                                   md-pro (private)
─────────                                  ────────────────
app/preferences.go     + FeatureSettings   pro/githistory.go (exec `git` log/show/status)
editor/serialize safe-render helper        pro/menu.go       (unchanged)
frontend/ui/gutterRail.ts (new); ToC →     frontend/src/register.ts        + changeHistory
  migrated to its first rail item
frontend/app/viewMode.ts  + overlay API    (md-pro frontend, cont.)
frontend/app/preferences.ts + featureSet   frontend/src/features/changeHistory.ts
frontend/app/features.ts  + rail on ctx    frontend/src/changeHistory/
frontend/index.ts      + exports             gitHistory.ts   (bindings wrapper)
pro_on.go              + register GitHist     railItem.ts (mountChangeHistoryRailItem + panel)
internal/pro-stub/pro/stub.go                 diffEngine.ts   (DiffEngine + MarkdownWordDiff)
  + mirror GitHistoryService                  diffView.ts     (builds DOM, drives VC overlay)
                                              changeHistory.css
```

Git data (log / file-at-ref / dirty-status) is fetched from a pro Go service via
generated Wails bindings. **All diff computation and rendering is frontend** — it
reuses the markdown-it parser (`editor.storage.markdown.parser`) that already
lives in the renderer, so the engine isn't split across the IPC boundary. The one
new dependency is **jsdiff** (`diff`) in `frontend/package.json` (generic,
tree-shaken from the OSS bundle). No new Go deps.

**OSS public-API additions (`frontend/src/index.ts`, add-only):** `getFeatureSetting`
/ `setFeatureSetting` (prefs bag access), a **safe markdown→HTML helper** (below),
and the `ViewController` + `GutterRail` types. **`FeatureContext` gains
`rail: GutterRail`** so a feature can register a rail item without reaching into
`host` or ToC. All additive — never reorder/remove (cross-repo stability).

---

## Go side — `md-pro/pro/githistory.go` (new)

Shell out to `git` via `os/exec` (precedent: `app/fileservice.go:85-96`). Args are
argv terminated by `--` (never a shell string). `exec.LookPath("git")` guards;
absent → empty results. Each method re-checks
`s.lic.HasEntitlement("change-history")` and fails closed (invariant #4).

```go
type GitHistoryService struct { lic *LicenseService }
func NewGitHistoryService(lic *LicenseService) *GitHistoryService

type CommitInfo struct {
    Hash, ShortHash, Subject, AuthorName string
    WhenUnixMs int64
    PathAtRef  string  // repo-rel path at that commit (rename-aware), forward-slashed
}

// History: git -C <dir> -c core.quotePath=false log --follow
//          --format=%x1e%H%x1f%h%x1f%an%x1f%at%x1f%s --name-only -n <cap> -- <path>
//   Newest-first; %x1e (RS) prefixes each commit, %x1f (US) separates header
//   fields, --name-only yields the per-commit path-at-that-commit → PathAtRef.
//   Then drops "cosmetic" commits (see below). Logs if truncated at <cap>.
func (s *GitHistoryService) History(filePath string) ([]CommitInfo, error)

// FileAtRef: git -C <dir> show <ref>:<pathAtRef>  (pathAtRef defaults to current rel).
func (s *GitHistoryService) FileAtRef(filePath, ref, pathAtRef string) (string, error)

// WorkingStatus: git -C <dir> status --porcelain -- <path>  (non-empty ⇒ dirty).
func (s *GitHistoryService) WorkingStatus(filePath string) (bool, error)
```

### Cosmetic-commit filtering
`History` drops commits whose only change to the file was whitespace — they'd
render an empty diff and just clutter the list. For each commit, run
`git diff --quiet --ignore-all-space <hash>^ <hash> -- <pathAtRef>`: exit 0 (no
whitespace-insensitive change) → drop; exit 1 → keep; no parent / other error
(root, first appearance after rename) → keep. Checks run concurrently (bounded
worker pool) so a long history stays fast (~100ms for 200 commits). (`git log -w`
does **not** do this — verified; it still lists whitespace-only commits.)
**Limitation:** `--ignore-all-space` also ignores *leading* whitespace, so a
re-indentation-only commit (list nesting / code indent) is treated as cosmetic and
hidden. Rare for prose; the stricter alternative is per-version markdown
normalization + neighbor-dedup (heavier — deferred).

### Git edge cases & robustness (explicit)
- **Timeouts:** `exec.CommandContext` with a bounded timeout (≈8s) so a hung/locked
  repo can't wedge the UI.
- **Repo-relative path:** `filepath.Rel(worktreeRoot, filePath)` → `filepath.ToSlash`
  — git refspecs and `--name-only` use forward slashes on every OS (Windows incl.).
- **Quoting / unicode:** `-c core.quotePath=false` (no octal-escaped non-ASCII) and
  `--name-only -z` (NUL-delimited) so **paths with spaces/unicode** parse cleanly.
- **Unborn HEAD** (new repo, no commits): `History` empty; `WorkingStatus` /
  `FileAtRef(HEAD,…)` map the "no HEAD"/"unknown revision" error to empty, not error.
- **Untracked file** in a repo: `git log` empty → only the working row (or empty state).
- **Staged-only changes:** `git status --porcelain` reports them → counted dirty.
- **Deleted / renamed current file, paths outside repo, non-zero exits:** caught and
  returned as empty (mirrors `FindGitRoot`'s not-exist tolerance), logged via the pro
  logger — degrade, don't error-spam.
- (Verified: `git log --follow --name-only` emits the pre-rename path for old commits,
  so `PathAtRef` is viable.)

### Seam edits in `md`
- `pro_on.go` (pro-tagged): after the `LicenseService` registration,
  `opts.ExtraServices = append(…, application.NewService(pro.NewGitHistoryService(lic)))`.
- `internal/pro-stub/pro/stub.go`: mirror `GitHistoryService`, `NewGitHistoryService`,
  `CommitInfo`, and the three methods with `panic()` bodies (tidy guard, invariant #6).
- Regenerate: `wails3 generate bindings -f "-tags=pro" -clean=true` →
  `frontend/bindings/github.com/emrul/md-pro/pro/githistoryservice.js` (+ models).

---

## OSS side

### Gutter rail (`frontend/src/ui/gutterRail.ts`, new) + ToC migration
A small owner of the left-of-content vertical icon stack. Factors out ToC's
measured-left positioning (`.ProseMirror` left edge − gap − button size, relative
to `host`) and adds **vertical slot assignment** so multiple items stack and
reflow as their visibility changes.
```ts
interface RailItemSpec { id: string; order: number; button: HTMLElement }
interface RailItemHandle {
  setVisible(v: boolean): void          // show/hide; triggers reflow
  onLayout(fn: (top: number) => void): () => void  // fires when this item's slot moves
  dispose(): void
}
interface GutterRail { register(spec: RailItemSpec): RailItemHandle; reposition(): void }
```
- The rail owns a container in `host`, sets the shared `left`, and lays visible
  items top-to-bottom by `order` with a fixed gap; `reposition()` runs on tab
  switch / resize / content-column move (the triggers ToC already handles).
- **Explorer-overlay coordination:** the rail takes `explorerState` and hides the
  **whole rail** while `explorer.overlayOpen` (matching ToC's current behaviour,
  now centralized — so every rail item inherits it instead of each re-checking).
- Items append their own **panel** next to their button and align it via
  `onLayout(top)` + the rail's shared left. Independent visibility → ToC hidden
  (short doc / source mode) frees its slot and Change History rises to the top.
- **ToC migration** (`frontend/src/ui/toc/index.ts`): instead of self-positioning,
  register its button (`order: 10`) and drive show/hide via `handle.setVisible`;
  position its panel via `onLayout`. Behaviour-preserving; its own
  `explorer.overlayOpen` hide-check becomes redundant (rail owns it); `toc.css`
  drops the absolute `top` it owned.
- `mountToc(tm, explorer, host)` gains the rail (constructed once in
  `bootEditor.ts` with `explorerState`, and shared); `bootEditor.ts` puts the rail
  on `featureCtx`.

### Safe markdown→HTML render helper (`frontend/src/editor/serialize/markdown.ts`)
The diff view must render user markdown to HTML **without** enabling raw inline
HTML. Today the only path is `editor/mode.ts:nodesFromMarkdown` — private, and it
returns PM nodes. Add a small exported helper so pro doesn't hand-roll `innerHTML`:
```ts
// markdown → HTML string via the editor's markdown-it (html:false → user HTML is
// escaped). Same parser/trust model as nodesFromMarkdown; callers inject only
// trusted diff elements around the result.
export function renderMarkdownToHtml(editor: Editor, md: string): string
```
Export it from `@markdownmd`. **Do not** flip the parser's `html` option.

### Preferences (`app/preferences.go` — Go done; frontend required)
Go (done in working tree): `FeatureSettings map[string]string`
(`toml:"feature_settings" json:"featureSettings"`), defaulted `{}`, plus
`GetFeatureSetting(key)` / `SetFeatureSetting(key,val)` (Go-side read-modify-write).

Frontend (`frontend/src/app/preferences.ts`) — **load-bearing, not optional:**
- Add `featureSettings: Record<string,string>` to the `Preferences` type + `defaults`
  (`{}`); `fromWire`: `p.featureSettings ?? {}`.
- **`updatePreference()` must include `featureSettings` in the `PrefsModel` it writes**
  — it enumerates every field, so omitting it means any unrelated save (e.g.
  `showDotFolders`) **wipes the bag**.
- Add `getFeatureSetting(key): string` (cache read) and
  `setFeatureSetting(key,val): Promise<void>` (Go `SetFeatureSetting` + cache refresh).

### ViewController read-only overlay (`frontend/src/app/viewMode.ts`)
Add a **generic** overlay API (diff-agnostic) so the diff view is VC-owned, not a
sibling that fights `setMode`/`toggle`/focus/Esc/tab-close:
```ts
openReadonlyOverlay(content: HTMLElement, opts?: { onClose?: () => void }): void
closeReadonlyOverlay(): void
readonly overlayOpen: boolean
onOverlayChange(fn: () => void): () => void
```
- Open: insert an `overlayParent` as a sibling of `hybridContainer`, hide
  `hybridContainer`+`sourceParent`, show `content`, bind Esc → close, focus it.
- Close: remove `content`, restore the element for the current `mode`
  (`hybridContainer` unless `mode==='source'` → `sourceParent`), refocus, fire
  `onOverlayChange`, call `opts.onClose`.
- `setMode`/`toggle`: if `overlayOpen`, close the overlay first (clean
  source→diff→source transitions). Tab close tears the overlay down with the mount.

### `@markdownmd` barrel (`frontend/src/index.ts`, add-only)
Export `getFeatureSetting`, `setFeatureSetting`, `renderMarkdownToHtml`, and the
`ViewController` + `GutterRail` types.

### `FeatureContext` (`frontend/src/app/features.ts`, add-only)
Add `rail: GutterRail`. `bootEditor.ts` constructs the rail (shared with ToC) and
puts it on `featureCtx`.

### Explorer entry point — **deferred** (no OSS no-op item)
The reserved `fileGit.Menu.Add("Show File History")` is left commented for now. A
dead/no-op OSS menu item is not acceptable, and wiring it OSS-side would also bake
a `pro.changeHistory…` command string into OSS Go. Defer until we confirm Wails 3
lets `pro.AppendMenus` register/mutate the explorer context menu cleanly from the
**pro** side; only then add it (pro-only, with the right path arg via the
`files.openPath` command — note: the command id is `files.openPath`, not
`openFile`). Not in v1.

---

## Frontend pro feature — `md-pro/frontend/src/`

### `features/changeHistory.ts` — the `FeatureModule` (id `pro.change-history`)
Mirrors `aiAssist.ts`. Imports core via `@markdownmd`, gating via `../license`.
- **`registerCommands(ctx)`** (every verb via the registry):
  - `pro.changeHistory.toggle` — show/hide the rail item; persist `changeHistory.show`
    via `setFeatureSetting`. Keybinding `Cmd+Shift+H` (free).
  - `pro.changeHistory.showDiff` — args `{ tabId, ref, pathAtRef, label }`;
    entitlement re-check → `showUpsell('change-history')` else open the diff view.
  - (`showHistoryForPath` for the explorer entry is **deferred** — see OSS side.)
- **`mount(ctx)`** (no `attachTab`, no editor plugin — like ToC): check
  `hasEntitlement('change-history')`; if not licensed, **return without registering
  the rail item** (hidden gating — no teaser). Else `import
  './changeHistory/changeHistory.css'` and `mountChangeHistoryRailItem(ctx)`.

### `changeHistory/railItem.ts` — `mountChangeHistoryRailItem(ctx)` (rail item + panel)
Modeled on `ui/toc/index.ts`, but it **registers a rail item** instead of
self-positioning:
- Create the `change-history-button` and `ctx.rail.register({ id, order: 20, button })`
  (below ToC's `order: 10`). `aria-haspopup`, `aria-expanded`. The rail assigns its
  slot; `handle.onLayout(top)` repositions the panel; `handle.setVisible(...)` shows/
  hides it (rail reflows so it rises to the top slot when ToC is hidden).
- A floating `change-history-panel` (ARIA table) toggled open/closed; dismiss on
  outside `mousedown` / Esc (mirror ToC's handlers).
- **Visibility:** `handle.setVisible(...)` true when the active tab is git-tracked
  (`tab.gitRoot` set, kept current by `bootEditor.attachGitRootTracking`) and
  `changeHistory.show` is on. Recompute on `tm.onChange` + active tab's `onChange`
  (cheap — visibility only; the rail handles reposition). **No per-keystroke git.**
- **Data fetch on open (cached):** on first open for a `{filePath, gitRoot}` fetch
  `History` + `WorkingStatus`; cache keyed by that pair. The **uncommitted row**
  derives from `tab.modified` (live) OR cached `WorkingStatus`; refetch `WorkingStatus`
  on a save (modified→false transition) while the panel is open. History refetch only
  on path/gitRoot change or explicit reopen.
- Rows: short hash · message · relative age (`title`=full datetime) · diff button →
  `commands.execute('pro.changeHistory.showDiff', { tabId, ref, pathAtRef, label })`.
  Empty states rendered in-panel (non-git / untracked / unborn / no `git`).
- **Clean-doc dedup:** when the document is clean — not dirty (`WorkingStatus`) and
  no unsaved edits (`tab.modified`) — the current doc equals the newest commit's
  content, so comparing to it is empty; drop the newest commit row (`commits.slice(1)`).
  If that leaves the list empty, show "Document matches the latest commit." When
  dirty/modified, keep all commits and show the pinned "Uncommitted changes" row.

### `changeHistory/diffEngine.ts` — `DiffEngine` + `MarkdownWordDiff`
Structure-aware so lists (bullet/ordered/task) and blockquotes diff at item/block
granularity, not as one text blob.
```ts
interface DiffSegment { kind:'equal'|'insert'|'delete'; text:string; original?:string }
type DiffNode =
  | { type:'text'; tag:'p'|'h1'..'h6'|'blockquoteLine';
      status:'unchanged'|'added'|'removed'|'changed'; segments:DiffSegment[] }
  | { type:'list'; ordered:boolean; items:DiffListItem[] }
  | { type:'blockquote'; children:DiffNode[] }
  | { type:'opaque'; status:'unchanged'|'added'|'removed'|'replaced'; oldMd?:string; newMd?:string }
interface DiffListItem { status:…; task?:{checkedOld?:boolean;checkedNew?:boolean}; children:DiffNode[] }
interface DiffEngine { diff(oldMd:string, newMd:string, md:MarkdownIt): DiffNode[] }
```
`MarkdownWordDiff` — **our markdown layer over jsdiff primitives** (we own parsing,
pairing, rendering; jsdiff owns the token diff):
1. **Parse** both versions into top-level **block records** via
   `editor.storage.markdown.parser.md` (token stream + `[startLine,endLine)` maps,
   the `hybridLoad.ts` technique): `{ kind, marker, text, raw }`.
2. **Block align** with `diffArrays(oldBlocks, newBlocks, { comparator })` keyed on
   `(kind + normalizedText)` — gives exact **anchors** (unchanged blocks) and
   delete/insert **runs**.
3. **Smarter pairing inside runs** (not just exact matches): within an aligned
   delete-run × insert-run, pair **same-kind** blocks by word-token **similarity**
   above a threshold (e.g. Sørensen/Dice over word sets); paired → `changed`,
   leftovers → `added`/`removed`. This is what makes an edited paragraph word-diff
   instead of showing a whole delete+insert.
4. **Per kind:**
   - **text / heading / list-item:** inline diff via `diffWordsWithSpace` (use
     `Intl.Segmenter` for word segmentation when available, else jsdiff's default);
     adjacent delete+insert → a replacement carrying `original` for hover.
   - **list:** `diffArrays` over items (then pair + word-diff as above); preserve
     marker (`-`/`1.`/`- [ ]`), compare task checkbox.
   - **fenced code:** **line-level** diff via `diffLines` (whole-block replacement
     reads badly for technical docs) — rendered in a `<pre>` with per-line
     ins/del. **Tables** stay opaque (`replaced`) for v1.
   - **blockquote:** recurse; **other opaque** (hr / image / raw HTML) whole-block
     `unchanged`/`replaced`.

### `changeHistory/diffView.ts` — full-surface read-only view (VC overlay)
- Build: `old = normalizeMarkdown(editor, await gitHistory.fileAtRef(filePath, ref, pathAtRef))`;
  `current = normalizeMarkdown(editor, tab.getCurrentMarkdown())`; `nodes = engine.diff(old, current, md)`.
  **Both sides go through `normalizeMarkdown`** (OSS, exported) — `old` is raw `git
  show` bytes, `current` is editor-serialized, so without canonicalizing both,
  identical content diffs as removed+added purely from serializer normalization.
- **Render to DOM safely (no inline-HTML enable).** The app keeps markdown-it
  `html:false` (`createEditor.ts`); **do not** turn it on for user content. Walk the
  `DiffNode` tree and **build the DOM ourselves**, creating trusted `<ins class="ch-ins">`
  / `<del class="ch-del">` elements and rendering each block's inline content via the
  shared OSS helper **`renderMarkdownToHtml(editor, md)`** (markdown-it `html:false`
  → user HTML escaped; same trust model as `nodesFromMarkdown`, but exported instead
  of duplicated). Set the returned string as `innerHTML` of a temp node, then walk
  its text nodes and wrap the word-diff runs;
  inject deleted runs as trusted `<del>` text nodes at their merged-order position
  (deletions render as struck plain text — old inline formatting on a deletion is a
  documented v1 nicety we skip). Lists/blockquotes are built as real `<ul>/<ol>/<li>/
  <blockquote>` so removed items can be interleaved in place; opaque `replaced` blocks
  render old inside `<div class="ch-block-removed">` then new inside `.ch-block-added`.
  Hover-original = `title` on the `<ins>`.
- Mount via `tab.viewController.openReadonlyOverlay(diffEl)`. **z-index 40** so it
  covers the gutter rail buttons (30) / panels (31) — `.tab-mount`/`.tab-host` don't
  create stacking contexts, so a lower z-index let the buttons show through.
- **Header:** `◀ back · title ("Compare current document to <shortHash> '<subject>'")
  · "N differences" + ↑/↓`. Each changed region (changed/added/removed text,
  heading, list item, code block, table) is tagged `.ch-anchor`; ↑/↓ cycle through
  them (wrapping), smooth-scroll the current one to center, outline it (`.ch-current`),
  and the count updates to "i / N". Zero differences → "No differences", buttons
  disabled. ◀/Esc close via the VC.

### `changeHistory/gitHistory.ts` — bindings wrapper
Thin wrapper over `@pro-bindings/pro/githistoryservice.js` (mirrors `license.ts`).

### `register.ts` (edit): `registerFeature(changeHistory)`.

### `changeHistory.css`
`--ch-ins` (blue), `--ch-del` (red, strikethrough), `.ch-block-added/-removed`,
`.change-history-button`/`-panel` (mirror `toc.css`), `.change-history-diff`
(z-index 40), `.ch-diff-nav`/`.ch-diff-count`/`.ch-nav-btn`, `.ch-current` (nav
highlight). Local — no OSS token churn.

---

## Known limitations / non-v1 gaps
- Read-only v1: **"restore this version"** and **"copy old version"** are intentional
  follow-ups (call out in UI copy if natural).
- History requires the `git` binary; absent → empty state.
- **Staleness:** history is fetched on panel open / path change and may be stale
  until the panel is reopened (e.g. a commit made in another tool). Automatic
  refresh is deferred to fsnotify-based file/repo watching.
- Explorer "Show File History" entry point deferred (see OSS side); v1 entry points
  are the rail item + the `pro.changeHistory.toggle` command.
- Word-diff is prose/list-focused; **tables** stay opaque (whole-block replaced) in
  v1 (code blocks get line-level diff); deletions render as struck plain text (no
  old inline marks).
- Client bundle is readable (per `pro-features.md`); protection is git-dev privacy +
  license gate, not runtime.

---

## Acceptance / verification
1. **Builds.** `npm install` (adds `diff`/jsdiff); `wails3 task build` (OSS, must
   succeed) and `wails3 task build:pro`. `npm run typecheck`.
2. **Bindings.** `wails3 generate bindings -f "-tags=pro" -clean=true`, then
   `MARKDOWNMD_LICENSE=test wails3 task dev:pro`.
3. **Rail + panel.** Git-tracked `.md` → a Change History rail item in the left
   gutter; with ToC visible they stack (ToC above), and with ToC hidden (short doc /
   source mode) Change History takes the top slot. Click → panel with newest-first
   rows (hash / message / relative age, full datetime on hover); diff button per row;
   "Uncommitted changes" row when dirty/unsaved; long history (>10) scrolls within the
   capped panel; `pro.changeHistory.toggle` hides/shows the rail item; rail repositions
   on window resize / column reflow.
   - **Cosmetic commits filtered:** a whitespace-only commit does **not** appear.
   - **Clean-doc dedup:** when the file is clean (matches HEAD, no unsaved edits),
     the newest commit row is hidden (it equals the current doc); if that's the only
     commit, the panel reads "Document matches the latest commit." (This is the
     `~/dev/emrul/portal-sync/docs/DESIGN.md` case.)
4. **Diff view + lists + code + nav.** Diff button → full-surface read-only overlay
   that **covers the gutter buttons** (z-index); word-level red-strike/blue with
   hover-original on a replacement; an **edited paragraph word-diffs in place**
   (similarity pairing, not a whole delete+insert); adding/removing a
   bullet/ordered/task item shows it inserted/struck with its marker; toggling a task
   checkbox marks the item changed; a **fenced code block shows per-line** ins/del; a
   **table** falls back to whole-block replaced. Header shows **"N differences"**;
   **↑/↓** cycle through changes (wrap), scroll-to-center + outline current, label →
   "i / N". ◀/Esc return to the prior view.
5. **Raw-HTML escaping (security).** A document containing `<script>…</script>` and
   `<img src=x onerror=…>` renders **escaped/inert** in the diff view — nothing
   executes (markdown-it stays `html:false`; only trusted `<ins>/<del>` injected).
6. **View transitions.** source → open diff → close → back in source (and the same
   from hybrid/wysiwyg); `⌘/` source toggle while diff open closes the overlay first;
   no focus/Esc conflicts.
7. **Tab close while diff open.** Closing the tab tears down the overlay cleanly — no
   leaked DOM/listeners, no console errors.
8. **Preference round-trip.** Set `changeHistory.show`, then change an unrelated pref
   (`showDotFolders`, pin a root) → `feature_settings` in `preferences.toml` is
   **preserved** (the `updatePreference` fix); survives restart.
9. **Git states.** untracked-in-repo, unborn-HEAD (fresh `git init`), staged-only
   changes, a path **with spaces/unicode**, and no `git` on PATH → correct empty
   states / dirty row, no errors or hangs (timeout path).
10. **Renames.** Rename a tracked file (`git mv`) and confirm pre-rename commits still
    appear (`--follow`) and their diff fetches the old path (`PathAtRef`).
11. **OSS cleanliness.** OSS build: no Change History rail item (ToC still works via
    the migrated rail); the free bundle contains **no pro strings and no pro imports**
    — `grep -rE "pro\.changeHistory|change-history|githistory|md-pro" frontend/dist`
    is empty, and the OSS bundle resolves `@pro` only to `src/pro-stub` (never the
    sibling). No "Show File History" menu item is added in OSS (deferred).
12. **ToC regression.** With the rail in place, ToC still appears for long docs
    (3+ headings), hides for short docs / source mode / explorer overlay, and its
    panel still scrolls to headings — behaviour-preserving after migration.
