# File explorer plan

Milestone 3 (App shell) — the sidebar piece. Sequel to the tab/multi-window/preferences chrome batch shipped in `ca2f599`. Direction settled with the user in a design session on 2026-05-27; this doc captures the decisions and the implementation order.

## Goal

A buttery, non-blocking file explorer that **follows what you're working on** by default and **gets out of your way** when you don't want it. Inspired by GitLab's tree component (clean UI, smooth expand/collapse, focused border on the row icon), tuned for a markdown editor rather than an IDE.

Explicit anti-goals: matching Obsidian or IntelliJ in features. Their explorers also block on large folders — we're aiming for less surface area, but with no jank.

## UX

### Chrome — minimal floating dock

A tiny floating dock anchored to the left edge, vertically centered. ~32px wide, auto-height (each icon ≈ 28px). Today it hosts a single folder icon; the structure grows downward as more surfaces are added (outline, search, plugin surfaces — 2–3 more before it warrants rethinking). The dock is the *trigger*; it persists across overlay open/close.

Translucent dark background with rounded right corners only (`border-radius: 0 6px 6px 0`). No permanent gutter is reserved — the editor uses the full viewport width when the overlay is closed. The dock floats on top of the editor surface, not alongside it. Inspired by `portal-agent`'s `#panel-handle` pattern.

**Ride behavior.** When the overlay opens, the dock slides to `left: <overlayWidth>` so it sits at the right edge of the panel. The same gesture (clicking the dock) opens *and* closes the explorer — the user always finds the trigger in the same place relative to the visible boundary. The `left` transition shares the panel's 200ms macOS easing so they move as one. During width-resize, the dock's transition is suppressed (`body.explorer-resizing .explorer-dock { transition: none }`) so it tracks the cursor 1:1.

### Overlay — slide-in panel

Clicking the dock's folder icon slides a panel in from the left edge of the viewport. The panel **overlays** the tab/editor area — it does **not** push them. No backdrop dim: the editor stays visible behind it (writing-app feel, not modal).

- Animation: `transform: translateX(-100%) → translateX(0)`, `transition: transform 200ms cubic-bezier(0.32, 0.72, 0, 1)` (macOS easing).
- Width: resizable via right-edge drag handle, persisted into per-window state (see [Window state](#window-state-shape)). Min 200px, max 600px.
- Dismissal — any of:
  - File opened from the tree (single-click on file, `Enter` on file row, or dblclick-open-all on a folder) → close.
  - Click anywhere outside the panel (editor, tab strip, anywhere not inside `.explorer-overlay` and not on `.explorer-dock`) → close. Right-click menus, native dialogs, and inline rename inputs do **not** count as "outside."
  - Dock icon clicked again → close (toggle).
  - `Esc` while panel has focus → close (deferred — not yet wired).
- Keyboard shortcut to toggle: `⌘⇧E`.

### Root resolution — two-tier

State on the explorer:

- `pinnedRoot: string | null`
- (derived) `effectiveRoot = pinnedRoot ?? contextualRoot`

Contextual root rules:
- Active tab is saved → `FindGitRoot(file)` walks up looking for `.git` (file or dir). If found, **the git root is the contextual root**. Otherwise fall back to `dir(activeTab.path)` (file's immediate parent).
- Active tab is untitled / no tabs → `$HOME`.

The git-walkup is the natural project-scope for technical-design work: editing `~/dev/foo/docs/api.md` shows you the whole `~/dev/foo` project, not just `~/dev/foo/docs`. The piggyback scan primes the cache when the explorer touches any repo subtree, so walk-ups are mostly cache hits in practice.

`effectiveRoot` is computed **only when the overlay opens**. While the overlay is open, root is sticky — switching tabs in the background does **not** move the root, so user exploration isn't obliterated. The next time the user closes and reopens the overlay, the root is re-derived from the (possibly different) active tab.

### Header navigation buttons

Two header buttons sit left of the breadcrumb area; both **pin** their target. Every effective-root change goes through the pin (one mental model; Reset is the dedicated escape hatch).

- **↑ Up** — pins `parent(currentRoot)`. Disabled when current root is already the filesystem root.
- **⌂ Home** — pins `$HOME`. Disabled when current root is already home.

A "filesystem root" button was considered and dropped — FS root is rarely useful for a markdown writer, and Up + Home covers it via a few clicks. Removing it also avoided an icon-choice headache and gave the header more breathing room.

**Header label adapts to the root.** When the effective root is `$HOME`, the header reads **Home** rather than the home folder's basename (`emrul`, etc.) — the disabled Home button alone isn't a strong enough cue. Full path remains in the title/aria-label tooltip.

### Pin and reset

- **Pin** (set as root): a small pin icon appears on folder rows on hover. Clicking it sets `pinnedRoot = folder.path`. Pin per row toggles — clicking the pin on the row that is currently the pinned root clears the pin.
- **Reset**: the overlay header shows a `×` (close) button when a pinned root is active. Clicking it sets `pinnedRoot = null`. The icon is `×` rather than `↺` so it doesn't read as "refresh."
- The header navigation buttons (Up / Home) are pins too — every effective-root change is a pin, with Reset as the single way back to contextual.
- Pin/unpin is **inline only** — not in the right-click menu. This avoids needing a `…-pinned` variant of every folder menu (would have caused combinatorial explosion when combined with git-status variants — see [Right-click menus](#right-click-menus)).

### File visibility

- **Dotfiles** (files starting with `.`): hidden by default. No toggle initially. Future: header toggle to reveal.
- **Dot-folders** (folders starting with `.`, e.g. `.github`, `.config`): **visible**. They commonly contain content worth navigating to.
- **Non-markdown files**: hidden by default initially. Future: show dimmed, click is no-op, right-click works (Reveal in Finder, Rename, Delete).
- **Markdown files**: `.md`, `.mdx`, `.markdown`. Single-click opens (respects `useTabs` preference, same path as `files.openFile`).
- **Empty folders**: hidden — a folder with no visible content (per the rules above) is not rendered. See [Empty-folder filtering](#empty-folder-filtering-and-git-detection-piggyback) for the cheap detection scheme.

The render filter is a **single shared function** between (a) what we display in a listing and (b) what counts as "content" when deciding whether a folder is empty. Keeping them in lockstep prevents the bug where we'd hide a folder that should show, or show a folder that expands to nothing.

### Sort order

Folders first, then files. Within each group, alphabetical, case-insensitive. Sort applied **in Go** (`os.ReadDir` already returns sorted, but Wails round-trip preserves order so the frontend can render directly).

### Selection and focus

- One row is "selected" at a time (persistent, survives keyboard nav). Rendered with `aria-selected="true"`.
- Keyboard focus is separate from selection. `:focus-visible` on the row's leading icon draws the focus ring (the GitLab touch — the ring sits around the icon, not the whole row).
- Selection persists across overlay open/close within the same window.

### Double-click on a folder

Opens every markdown file directly inside the folder as tabs (non-recursive — descendants are not walked). Uses the same multi-file open path as `File > Open` with multi-select: tabs are created with `defer: true` so only the last (active) one materialises up front; the rest pre-warm in idle slots.

Implementation note: single-click on a folder defers its expand-toggle ~250ms so a follow-up click can elevate the gesture to a double-click. Adds a small latency to single-click expand but keeps the gesture reliable.

### Keyboard

- `↑` / `↓` — walk visible rows.
- `→` — expand folder; if already expanded or it's a file, descend to next visible row.
- `←` — collapse folder; if already collapsed or it's a root file, ascend to parent.
- `Enter` — open file (files only).
- `F2` — rename.
- `⌘⇧E` — toggle overlay (also bound globally so it opens the panel and focuses it when closed).
- `Esc` — close overlay if open and focused.

## Right-click menus

Four menus, registered up front in `menu.go` alongside the tab menus. Selection axis is **git-status**: each row's `entry.gitRoot` (computed Go-side, see [Git detection](#git-detection)) determines whether the `-git` variant is used. Pin status is **not** an axis — pin/unpin is inline (see above).

Frontend picks the menu via `--custom-contextmenu: explorer-{folder,file}{,-git}`; row's absolute path goes in `--custom-contextmenu-data`. **All menu items emit the standard `command` event** (per `docs/architecture.md`'s command-registry rule) with payload `{ id, args: { path } }`. The dispatcher in `app/main.ts` is already extended for this shape.

```
explorer-folder
  Reveal in Finder
  ───
  New File
  New Folder
  ───
  Rename
  ───
  Refresh

explorer-folder-git
  (same as explorer-folder initially; ready to grow with
   "Show in Git Log", "Discard Changes in Folder", etc.)

explorer-file
  Open in New Window
  Reveal in Finder
  Copy Path
  ───
  New File          (creates in this file's parent dir)
  New Folder        (creates in this file's parent dir)
  ───
  Rename

explorer-file-git
  (same as explorer-file initially; ready to grow with
   "Show File History", "Show Diff", "Discard Changes",
   "Stage / Unstage", "Compare with HEAD", etc.)
```

**Delete is not in M3.** Deferred to M4 alongside proper OS-trash integration (`osascript` on macOS, `gio trash` on Linux, `IFileOperation` on Windows). Permanent delete with a single confirm is too sharp; users can right-click → Reveal in Finder and delete from the OS until trash semantics land.

Item builder uses a shared command-routing helper rather than bespoke per-action event names:

```go
// menu.go
func emitCommandToCurrentWindow(app *application.App, cmdId string) func(*application.Context) {
    return func(ctx *application.Context) {
        win := app.Window.Current()
        if win == nil { return }
        win.EmitEvent("command", map[string]any{
            "id":   cmdId,
            "args": map[string]any{"path": ctx.ContextMenuData()},
        })
    }
}

addCommonFolderItems := func(m *application.Menu) {
    m.Add("Reveal in Finder").OnClick(emitCommandToCurrentWindow(app, "explorer.revealInOS"))
    m.AddSeparator()
    m.Add("New File").OnClick(emitCommandToCurrentWindow(app, "explorer.newFile"))
    // ...
}

folder := app.ContextMenu.New()
addCommonFolderItems(folder.Menu)
app.ContextMenu.Add("explorer-folder", folder)

folderGit := app.ContextMenu.New()
addCommonFolderItems(folderGit.Menu)
// future: folderGit.Menu.Add("Show in Git Log").OnClick(...)
app.ContextMenu.Add("explorer-folder-git", folderGit)
```

The frontend just registers handlers in `commands/explorer.ts` keyed by command ID; the menu wiring is fully data-driven. Tab context menus stay on their bespoke event names for now — migrating them to the same shape is a future cleanup, not M3 work.

**No empty-area menu.** Right-clicking whitespace inside the overlay does nothing. New File / New Folder / Refresh live in the overlay header. Can add `explorer-empty` later if users actually reach for it.

## Drag to editor — insert as markdown link

Dragging a `.md` or `.mdx` row from the tree onto an open editor inserts a markdown link at the drop position. Link target is computed relative to the receiving document; link text is the filename minus extension.

### Drag source — tree row

`Row.ts` makes `.md`/`.mdx` rows draggable via HTML5 `draggable="true"`. On `dragstart`:

- `dataTransfer.setData('application/x-markdownmd-path', absolutePath)` — custom MIME, so the drop side can distinguish a tree row from random text drags or external file drops.
- `dataTransfer.effectAllowed = 'copy'`.
- Default drag image (the row itself, semi-transparent). Custom drag image is polish, deferred.

Folder rows are also draggable but use a **distinct MIME** (`application/x-markdownmd-folder-path`). The drop handler differentiates and inserts a `bulletList` of links to direct markdown children (non-recursive, same scope as double-click-open-all). Empty folders no-op silently.

Non-md files do **not** get the `draggable` attribute. Reset Root / pin icon interactions are unaffected because they bind on `mousedown`/`click`, not drag.

### Drop target — TipTap editor

A ProseMirror plugin at `editor/extensions/treeDropHandler.ts` intercepts `drop`:

1. Bail out unless `dataTransfer.types.includes('application/x-markdownmd-path')`. Lets TipTap's existing image-drop and other defaults run for non-tree drops.
2. Read the absolute path from `dataTransfer`.
3. Call `WorkspaceService.RelativeLinkPath(fromFile, toFile)` Go-side. Returns either a posix-style relative path (`./api.md`, `../c/baz.md`) or a `file:///` absolute URL for the cases where relativization isn't meaningful.
4. URL-encode the returned path (spaces → `%20`, etc.).
5. Compute drop position with `view.posAtCoords({ left: e.clientX, top: e.clientY })`; fall back to doc end if null.
6. Insert via `editor.commands.insertContentAt(pos, [{ type: 'text', text: linkText, marks: [{ type: 'link', attrs: { href } }] }])`.

`dragover` on the editor sets `dropEffect = 'copy'` when our MIME is present so the cursor shows the copy hint.

**Why Go-side relativization.** A naive posix helper over absolute paths breaks on Windows: drive letters, backslash separators, and cross-drive drops are all wrong. `filepath.Rel` + `filepath.ToSlash` in Go handles all of this correctly. The Go side also handles the edge cases (untitled target, cross-drive) uniformly. Drop is a user gesture — one IPC call adds a few ms and is invisible.

```go
func (s *WorkspaceService) RelativeLinkPath(fromFile, toFile string) (string, error) {
    if toFile == "" { return "", errors.New("toFile required") }
    // Untitled source → no anchor for a relative path. Return an absolute file URL.
    if fromFile == "" {
        return fileURL(toFile), nil
    }
    fromDir := filepath.Dir(fromFile)
    rel, err := filepath.Rel(fromDir, toFile)
    if err != nil {
        // Cross-drive on Windows, or unrelated absolute paths.
        return fileURL(toFile), nil
    }
    rel = filepath.ToSlash(rel)
    if !strings.HasPrefix(rel, "../") && !strings.HasPrefix(rel, "./") {
        rel = "./" + rel
    }
    return rel, nil
}

// fileURL builds a standards-compliant file:// URL from an absolute path.
//   POSIX:   /foo/bar     → file:///foo/bar
//   Windows: D:\foo\bar   → file:///D:/foo/bar
func fileURL(absPath string) string {
    slashed := filepath.ToSlash(absPath)
    if !strings.HasPrefix(slashed, "/") {
        slashed = "/" + slashed
    }
    return "file://" + slashed
}
```

### Link text

Filename minus extension. `api-design.md` → `api-design`. User can edit after insertion. Reading the file's first heading as link text is nicer but adds an FS read on every drop; defer.

### Relative path examples

- Source `/a/b/spec.md`, dragged `/a/b/api.md` → `./api.md`.
- Source `/a/b/spec.md`, dragged `/a/c/baz.md` → `../c/baz.md`.
- Windows: source `C:\dev\spec.md`, dragged `C:\dev\api.md` → `./api.md` (normalized to forward slashes).
- Windows cross-drive: source `C:\dev\spec.md`, dragged `D:\notes\api.md` → `file:///D:/notes/api.md`.
- Filename with spaces → URL-encoded in the href, raw in the text.

`file://` URLs use the standard three-slash form (`file:///`) for both POSIX absolute paths (`file:///Users/...`) and Windows drive paths (`file:///D:/...`). Helper `fileURL(absPath)` in `workspaceservice.go` handles both via the same rule: `ToSlash` + ensure a leading `/`. (UNC paths `\\server\share\...` are out of scope for v1.)

### Edge cases

- **Untitled target (no `filePath`).** `RelativeLinkPath` returns `file://<absolute>` and we `log.warn('drop', 'inserted absolute path; save the document to use relative paths')`. User can fix when they save.
- **Dropping a file onto itself.** Allowed; yields `[name](./name.md)`. Rare, not worth special-casing.
- **External Finder drag.** Out of scope — the custom MIME check rejects cleanly. TipTap's image-drop and similar continue to work for other types.
- **Multi-file selection drag.** Out of scope — single-file MVP. The tree doesn't support multi-select yet.

### Module placement

- `ui/explorer/Row.ts` — drag source (sets MIME + path on `dragstart`).
- `editor/extensions/treeDropHandler.ts` — ProseMirror plugin; calls `WorkspaceService.RelativeLinkPath` Go-side per drop.

Relativization lives entirely Go-side, so neither `editor/` nor `ui/explorer/` owns a path-manipulation helper, and there's no dependency edge between the two modules.

## Window state shape

Persistence is a follow-up task (window state, tab state, crash recovery). For this milestone we just need the data shape to be ready.

```ts
// frontend/src/app/explorerState.ts
type ExplorerState = {
  overlayOpen: boolean
  overlayWidth: number          // px
  pinnedRoot: string | null     // null = contextual mode
  selectedPath: string | null
  expandedPaths: Set<string>    // absolute paths
}
```

Lives in memory per window. Exposes a `subscribe(listener)` for future serialization — a follow-up persistence layer subscribes here, writes JSON to a per-window state file (e.g., `<configDir>/MarkdownMD/windows/<id>.json`). No fields land in `preferences.toml` (that file is app-global; window state is per-window).

URL boot params (`?file=…`, `?folder=…`) remain the immediate-restore path; the per-window state file is the comprehensive-restore path that comes with the persistence task.

## Filesystem strategy

Research summary (after surveying Mutagen, fastwalk, godirwalk, and the stdlib): **Mutagen uses `os.File.Readdirnames(0)` straight from the stdlib** in `pkg/filesystem/directory_posix.go` / `directory_windows.go`. The most perf-paranoid Go project in this space concluded the stdlib was fine and spent its budget on atomicity, watching, and cache. We follow suit.

### Go service

```go
// workspaceservice.go
type WorkspaceService struct { /* git-root cache, pending-cancel map */ }

type DirEntry struct {
    Name    string `json:"name"`
    Path    string `json:"path"`
    IsDir   bool   `json:"isDir"`
    Mtime   int64  `json:"mtime,omitempty"`   // folders only — Unix ms; used by cache validity check
    GitRoot string `json:"gitRoot,omitempty"` // "" = not in any repo. For a folder containing its own .git, equals Path.
}

type ReadDirResult struct {
    Path             string     `json:"path"`
    ParentMtime      int64      `json:"parentMtime"`              // Unix ms; cached for validity checks via StatMtimes
    GitRoot          string     `json:"gitRoot"`                  // "" = not in any repo
    Entries          []DirEntry `json:"entries"`                  // filtered (dotfiles, empty folders) + annotated
    EmptinessUnknown bool       `json:"emptinessUnknown,omitempty"` // set when piggyback skipped (>200 folders)
    Streaming        bool       `json:"streaming,omitempty"`      // true → more batches arriving via dir-batch:<requestID>
    RequestID        string     `json:"requestId,omitempty"`      // set iff Streaming=true
}

func (s *WorkspaceService) ReadDir(path, requestID string) (ReadDirResult, error)
func (s *WorkspaceService) CancelReadDir(requestID string) error // (step 9)
func (s *WorkspaceService) FindGitRoot(path string) (string, error)            // walks up; "" = not in a repo
func (s *WorkspaceService) StatMtimes(paths []string) ([]int64, error)         // batched stats for cache validity
func (s *WorkspaceService) RelativeLinkPath(fromFile, toFile string) (string, error) // for drag-to-editor
func (s *WorkspaceService) HomeDir() (string, error)
func (s *WorkspaceService) CreateFile(path string) error
func (s *WorkspaceService) CreateFolder(path string) error
// RenameFile already exists on FileService — reuse. Reveal also lives on FileService.
// Delete: deferred to M4 (see [Things deferred]).
```

**`GitRoot` is the enclosing repo path** — not "is this itself a repo." Inherited from the parent for descendants of a known root; equals own path when the folder contains a `.git` entry; empty string when there's no repo ancestor at all. This is what the right-click menu's git-axis switches on (`entry.gitRoot != ""` → `-git` variant). The frontend derives "is this folder itself a repo root?" as `entry.gitRoot === entry.path` when rendering the tree decoration.

### Listing — explicit-handoff streaming

The frontend always calls `ReadDir(path, requestID)`. Go opens the directory once and reads the first chunk synchronously. From there, two cases:

**Small folder (one chunk fits, EOF reached).** `ReadDir` returns `ReadDirResult{ Streaming: false, Entries: <complete> }`. The frontend renders and is done — no event listeners needed for this listing.

**Big folder (more entries remain after first chunk).** `ReadDir` returns `ReadDirResult{ Streaming: true, RequestID, Entries: <first chunk, filtered + piggyback'd> }` and kicks off a goroutine that continues reading via `f.ReadDir(BatchSize)` calls, emitting `dir-batch:<requestID>` per filtered+piggyback'd batch. When done, emits `dir-done:<requestID>`.

```go
func (s *WorkspaceService) ReadDir(path, requestID string) (ReadDirResult, error) {
    f, err := os.Open(path)
    if err != nil { return ReadDirResult{Path: path}, err }
    // Don't defer Close — may be transferred to the streaming goroutine below.

    // Determine path's own GitRoot up-front (walk up).
    parentGitRoot, _ := s.FindGitRoot(path)

    first, readErr := f.ReadDir(BatchSize)
    entries, parentIsGitRoot := s.filterAndPiggyback(path, parentGitRoot, first)
    res := ReadDirResult{
        Path:    path,
        GitRoot: gitRootOrSelf(parentGitRoot, path, parentIsGitRoot),
        Entries: entries,
    }
    if readErr == io.EOF || readErr != nil {
        f.Close()
        return res, nil // Single-batch case.
    }

    // Big-folder case: hand the open *os.File to a goroutine.
    ctx, cancel := context.WithCancel(context.Background())
    s.registerPending(requestID, cancel)
    res.Streaming = true
    res.RequestID = requestID
    go s.streamRemaining(ctx, f, path, res.GitRoot, requestID)
    return res, nil
}
```

The frontend's contract is uniform: every `ReadDir` returns synchronously with an initial result. If `Streaming` is true, subscribe to `dir-batch:<requestID>` for additions and `dir-done:<requestID>` for terminus — otherwise, you're done.

**Cancellation** — `CancelReadDir(requestID)` cancels the in-flight context, the goroutine exits on its next `ctx.Err()` check, and the open file is closed. The frontend ignores any in-flight batches that arrive after issuing a cancel.

**BatchSize** is an app constant in `workspaceservice.go` — start at 512, tune empirically.

**Sort order under streaming.** `os.File.ReadDir(n)` returns entries in *directory storage order* — not the lexicographic order `os.ReadDir(name)` provides. So in any streamed listing (the initial synchronous chunk **and** every later `dir-batch` event) the entries arrive unsorted.

Two consequences for the frontend:

- **The same sorted-insert path applies to the initial chunk and every later batch.** When `ReadDirResult.Streaming === true`, the frontend does **not** treat `result.entries` as the final order — it routes those entries through the same sorted-insert pipeline that handles `dir-batch:<requestID>` events. (When `Streaming === false`, `result.entries` is already sorted by `os.ReadDir(name)` + our case-insensitive resort, and the frontend renders it directly.)
- **One comparator, defined once:** `(a, b) => a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.toLowerCase().localeCompare(b.name.toLowerCase())` — folders before files, then case-insensitive name. Used by binary-search-insert for streamed batches and by the rare client-side re-sort if we ever need one. Keep it in `services/workspace.ts` so the cache and the streaming pipeline share a single definition.

User experience: rows pop into their correct alphabetical positions as they arrive — slightly visible motion for huge dirs but no jank, and the final state is sorted.

`getdents` / `getdirentries` / `FindNextFile` populate the dirent buffer; we use `entry.Type().IsDir()` (never `entry.Info()` or `os.Lstat`) to populate `IsDir`. Zero extra syscalls per entry beyond the lstat each subfolder's mtime requires for the cache validity story.

### Empty-folder filtering and git detection (piggyback)

Two things we need per subfolder: "does it have any visible content?" (so we can omit empty folders) and "is it a git root?" (so we can decorate it and prime the git cache). Both questions are answered by **the same scan** — one open + at most one chunked `ReadDir` per subfolder. They share a loop.

```go
func scanForListing(path string) (hasContent, isGitRoot bool) {
    f, err := os.Open(path)
    if err != nil { return true, false }  // unreadable → render it; user discovers
    defer f.Close()
    for {
        batch, err := f.ReadDir(64)
        for _, e := range batch {
            if e.Name() == ".git" { isGitRoot = true }
            // Visible-content rule mirrors the render filter:
            // dotfile (and not a folder) → doesn't count; everything else counts.
            if !(strings.HasPrefix(e.Name(), ".") && !e.Type().IsDir()) {
                hasContent = true
            }
            if hasContent && isGitRoot { return }  // both known — stop early
        }
        if err == io.EOF || err != nil { return }
    }
}
```

**Why this works cheaply:**

- Short-circuits as soon as **both** bits are determined. For a typical mixed folder containing a `.git`, we read one chunk and stop.
- `.git` is created early in a repo's life and usually sits in the first `getdents` chunk, so we hit it fast even when it's not the only thing in the folder.
- Worst case (no `.git`, all dotfiles) — full listing read. Still bounded by the subfolder's own size.

**Concurrency.** After we've collected the parent's entries, we kick off `scanForListing` on every folder entry through a **bounded worker pool** (16 goroutines). Each worker also `os.Lstat`s its subfolder to capture the mtime for the cache validity map. Wall time per parent ≈ `slowest scan in pool / 16 × N_folders`. For typical parents (tens of subfolders): a few ms total, invisible.

**Threshold for very large parents.** If parent has more than `FolderListingPiggybackThreshold` folder entries (an app constant in `workspaceservice.go`, **200**), we **skip the emptiness scan** for that listing and set `ReadDirResult.EmptinessUnknown = true`. Go still does a **stat-only pass** over the folders so each entry has a real `Mtime` (~5–10µs per stat vs ~30µs per piggyback open — so the wide-parent case stays cheap even when we skip). All folders are returned without the empty filter applied; the frontend treats the listing as a placeholder and arranges idle backfill (step 10) which calls a future `ScanFolders(paths)` method to fill in `hasContent` + `gitRoot` per subfolder. The user sees the listing instantly; a small number of folders quietly vanish or pick up a git decoration a tick later once backfill resolves.

The threshold is tight on purpose. A markdown workspace with > 200 subfolders in one directory is unusual; tightening favours correctness (no rendered-then-vanishing folders in normal use) over saving idle CPU on the rare wide-fan-out parent.

**Bonus #1 — the parent itself.** The first pass already iterates parent's own entries to apply the file filter; spotting `.git` there populates the parent's own git-root status for free (it's used to set `ReadDirResult.GitRoot` to the parent's path when its `FindGitRoot` walk-up doesn't already give us an ancestor).

**Bonus #2 — git cache priming.** Every time the scan finds `.git` in subfolder X, we set `gitRootCache[X] = X` immediately. Any later `FindGitRoot(X/anywhere/deep)` walks up, hits the cache on the first step, and returns instantly. So opening a file from inside a known repo never blocks on git detection — the explorer has already paid the cost incidentally.

**Per-entry `GitRoot` assignment.** After the piggyback completes:

- For folder entries: if the scan flagged the subfolder as itself containing `.git` → `entry.GitRoot = entry.Path`. Otherwise → `entry.GitRoot = parentGitRoot` (inherited).
- For file entries: `entry.GitRoot = parentGitRoot`.

This is what the right-click menu's git-axis switches on. `entry.GitRoot != ""` → `-git` variant. Frontend derives "is this folder itself a repo root?" as `entry.gitRoot === entry.path`.

**Future filter changes.** If the "show non-md dimmed but click is no-op" toggle ships and a folder containing only non-md files should also be hidden, update `scanForListing`'s content rule and the render filter together — they must mirror each other. This is the only correctness-coupling point in the explorer.

### Caching

`Map<path, { parentMtime: int64, subfolderMtimes: { [subPath: string]: int64 }, result: ReadDirResult }>` in the frontend. `parentMtime` and per-subfolder `Mtime` both come directly from `ReadDirResult` (no extra round-trip to populate the cache).

**Why subfolder mtimes are part of the validity check.** Empty-folder filtering depends on subfolder *contents*. When `child/foo.md` is created externally, the parent's mtime doesn't change but `child`'s does (POSIX guarantees a dir's mtime updates on entry add/remove/rename in that dir, but not on descendant content change). So parent-mtime-only caching can wrongly continue to hide a now-useful folder. Including subfolder mtimes catches this.

On re-expand:
1. Frontend calls `WorkspaceService.StatMtimes([parent, sub1, sub2, ...])` — a single Wails round-trip that returns Unix-ms mtimes for the listed paths (0 for any path that errors).
2. Compare to cached `parentMtime` + `subfolderMtimes`. If all match, render from cache instantly.
3. Else (parent or any subfolder mtime changed), call `ReadDir` and refresh the entry.

Cache-hit validation costs one `StatMtimes` call (~1ms for 100 paths) — negligible against the ~3ms of opens we'd pay on a piggyback miss, and the user perceives it as instant.

Wide-fan-out listings (`EmptinessUnknown: true`) still benefit from this cache: subfolder mtimes are populated by the stat-only pass, so when the user re-expands and nothing has changed, we return the cached placeholder. The idle backfill (step 10) is what fills in real `hasContent`/`gitRoot` values, separately from the cache validity story.

Invalidate on explicit refresh, on rename/create/delete operations we performed, and on window focus (soft refresh — entire cache dropped). Future: fsnotify will plug in here and replace the focus-refresh fallback.

**Known limitation until fsnotify:** external file creation *inside a currently-hidden empty folder* won't unhide the folder until the next focus refresh or explicit refresh. The folder's own mtime changes, but our cache has no entry to invalidate because the parent's listing currently excludes it. fsnotify resolves this by tracking the hidden-empty set and re-evaluating on any descendant event.

### Idle work

`requestIdleCallback` is behind WebKit's experimental flag and not on by default in the WKWebView Wails 3 ships, so we polyfill it. The polyfill lives once at boot:

```ts
// frontend/src/app/idleCallback.ts
if (typeof requestIdleCallback === 'undefined') {
  (window as any).requestIdleCallback = (fn: IdleRequestCallback) =>
    setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 50 } as any), 1)
  ;(window as any).cancelIdleCallback = (id: number) => clearTimeout(id)
}
```

Loses true "actually idle" scheduling — next-tick instead — but that's fine for prefetching, cache priming, and emptiness backfill. We're not in microsecond-budget territory. If WebKit ever ships it unflagged, the polyfill becomes a no-op.

Used for:
- Pre-warming siblings of the active tab's parent dir on overlay open.
- Backfilling emptiness + git status for parents that exceeded the > 200-folder threshold (see [Empty-folder filtering and git detection](#empty-folder-filtering-and-git-detection-piggyback)).
- Pre-fetching first level of unexpanded folders that are about to scroll into view.
- `FindGitRoot` for newly-opened tabs whose paths weren't already in the cache.

All cancellable by the time the user actually interacts.

## Git detection

Two paths, both feeding the same per-window cache:

1. **The piggyback** (see [Empty-folder filtering and git detection](#empty-folder-filtering-and-git-detection-piggyback)). Every time a folder is listed, its subfolders' git-root status is determined by the same scan that checks emptiness — no extra syscalls. `gitRootCache[X] = X` is set the moment `.git` is spotted in X. Tree decoration data arrives in the `ReadDirResult` itself — no second round-trip.

2. **`FindGitRoot(path)`** — walks **up** from `path` looking for `.git` (file *or* dir — worktrees use a file). Per-window memo cache keyed by directory. Used when we need to know "what repo is this path inside?" for paths we haven't visited via the explorer. The walk-up terminates fast in practice because the piggyback has already cached every directory the explorer has touched.

### Uses

1. **Contextual root.** When the overlay opens, the explorer calls `FindGitRoot(activeTab.filePath)`. If a git ancestor exists, that's the contextual root; otherwise `dir(activeTab.filePath)`. This is what makes the explorer feel project-aware by default. See [Root resolution](#root-resolution--two-tier).

2. **Tree decoration.** Each `DirEntry` carries `GitRoot` directly, set by the piggyback (own path if this folder contains `.git`, the inherited parent's repo path otherwise, empty when not in any repo). The frontend renders a subtle git-branch decoration (muted glyph next to the folder icon, no color noise) when `entry.gitRoot === entry.path` — i.e. this folder is itself a repo root. No async re-render needed — the data arrives with the listing.

3. **Tab marker (internal).** When a tab is opened (from the explorer or otherwise), `WorkspaceService.FindGitRoot(filePath)` runs in a goroutine; the result is set on `tab.gitRoot` (empty string = not in a repo). Purely a data attribute today — no visual treatment on tabs. Future use: "Show File History", diff view, etc., gated on `tab.gitRoot != ""`. If the file is inside a directory the explorer has touched, the walk-up cache short-circuits on the first step.

Cache invalidation is rare in practice (`.git` rarely appears or disappears during a session) — drop on explicit refresh; trust otherwise. A pathological case is `git init` happening while the explorer is open; we don't try to detect that automatically until fsnotify lands.

## Performance budget

The slide-in transition runs 200ms after the user clicks the dock icon. The `ReadDir` call starts at the same instant — so in practice the fetch completes during the slide, and the first paint lands at or near slide completion.

- **Icon click → root contents visible: ≤ 280ms total** (200ms slide + ≤ 80ms post-slide first-paint headroom).
- **Expand a folder → first render of children**: ≤ 50ms for cached, ≤ 150ms for fresh on normal folders.
- **Big folders (5k+ entries)**: first chunk (filtered) returned in the synchronous `ReadDir` response within ≤ 200ms; remainder streams via `dir-batch:<requestID>` and reaches the user within a couple hundred more ms.

The user perceives a smooth open-then-fill: panel slides in, and contents are there as the slide settles. We do **not** delay the fetch until after the transition completes — we run them concurrently and accept that on a very fast machine the contents may pop in before the slide is done (looks fine; no jank).

## Things deferred to M4 (or later)

- **fsnotify watcher.** Manual refresh + window-focus soft refresh covers M3. Plug-point is the cache invalidation hook; replaces the focus-bypass fallback for the empty-folder-filter staleness window. **A specific M4 use-case fsnotify enables:** a **deep-emptiness cache** — a "has-markdown anywhere below" bit maintained per folder, invalidated by fs events on any descendant. This is the proper fix for the `~/DataGripProjects`-shaped problem: folders that look empty to a markdown user because their subtree contains only non-markdown files (project sources, IDE caches, etc.). Our M3 one-level scan keeps them visible because non-dot subdirs count as content; with fsnotify we can affordably do deep checks and stay fresh. Without fsnotify, recursive scans on first expand would either be too slow or go silently stale, so we wait.
- **Delete (with OS trash).** No Delete menu item or `Del` shortcut in M3. M4 adds delete-to-trash per platform (`osascript` on macOS, `gio trash` on Linux, `IFileOperation` on Windows). Permanent-delete is not a target.
- **Streaming for very large directories + idle backfill for > 200-folder parents.** The current monolithic `ReadDir` handles everything a markdown workspace realistically encounters; the wide-fan-out skip path (`EmptinessUnknown=true`) prevents pathological folders like `~/Library` or `/` from blocking the open. Activate streaming when a user actually feels the lag on a real directory. **Design preserved in the API + plan sections** so the work is a refactor, not a re-derivation: `ReadDir` already takes a `requestID` parameter; `ReadDirResult` already has `Streaming` / `RequestID` / `EmptinessUnknown` fields; the explicit-handoff protocol and the directory-order-streaming-with-sorted-insert path are documented in [Listing — explicit-handoff streaming](#listing--explicit-handoff-streaming). The deferred backfill is the idle pass that resolves `EmptinessUnknown` listings — also activated when this lands.
- **Drag within the tree** (move files between folders) and **from tree to tab strip**. The from-tree-to-editor case is in scope this milestone — see [Drag to editor](#drag-to-editor--insert-as-markdown-link).
- **Search / filter input** in the overlay header — type-to-filter visible nodes.
- **Multi-root workspaces.** Single root is the model for now. If we add this, the `pinnedRoot` field becomes `pinnedRoots: string[]`.
- **Dotfile reveal toggle**, **non-md show-dimmed toggle**.
- **Window state persistence** — the `ExplorerState` shape is ready; the persistence layer is its own task.
- **Tab context menus migrated to the `command` event shape.** Cleanup to align with the architecture rule; not blocking.

## Frontend module layout

```
frontend/src/ui/explorer/
  index.ts                  # mountExplorer: dock + overlay shell (step 2 — shipped)
  ExplorerHeader.ts         # root breadcrumb / Reset chip / New File / New Folder buttons (step 6)
  Tree.ts                   # the tree component (renders the row list) (step 3)
  Row.ts                    # one row (folder or file) with hover-pin icon (step 3)
  styles.css                # explorer styling (tokens in styles/tokens.css)
frontend/src/app/
  explorerState.ts          # ExplorerState class + subscribe API (step 2 — shipped)
frontend/src/services/
  workspace.ts              # thin wrapper over Wails WorkspaceService bindings + cache (step 8)
```

Mount in `frontend/src/app/bootEditor.ts` after the existing chrome. Toggle exposure: `view.toggleExplorer` command (registered in `commands/index.ts`), bound to `⌘⇧E`, accessible from the native View menu (`menu.go`) and the command palette (when it ships).

## Implementation order (suggested)

Each step is independently shippable. Stop and verify at each step.

**Prerequisite checks (do first, take minutes not hours):**

- Confirm the command registry's `dispatch(id, args)` signature handles arguments — right-click handlers carry a path. (Per user: yes, already supported.)
- Verify `tabManager.active()` exists and returns the active `Tab` (or `null`). Step 5 reads `tabManager.active()?.filePath`. Add it if missing.

**Step 0 — Logs window.** Small infrastructure, lands before the explorer so its error paths plumb into the log from day one.

- `LogService` (Go) with an in-memory ring buffer (500 entries). Entry shape `{timestamp, level, source, message}`. Levels `info | warn | error`. Emits `log:appended` on each entry. Methods: `Append(level, source, message)`, `Snapshot() []Entry`, `Clear()`.
- New Wails window opened via `WindowService.OpenLogsWindow()` (cascading offset like other multi-window opens). Simple frontend: list view, auto-scroll-to-bottom, Clear button. Subscribes to `log:appended` for incremental render; initial render uses `Snapshot()`.
- `menu.go`: View → Logs → `commands.view.openLogs`.
- Frontend `services/log.ts` wraps the bindings and exposes `log.info/warn/error(source, message)` for ergonomic use elsewhere.

1. **Go WorkspaceService skeleton.** `ReadDir(path, requestID) → ReadDirResult` with the piggyback scan producing emptiness + per-folder mtime + per-folder "contains .git" flag. Per-entry `GitRoot` populated by inheriting from the parent (computed via `FindGitRoot` at the start of `ReadDir`). Worker pool, `FolderListingPiggybackThreshold` = 200. `HomeDir`. Wire up in `main.go`. (No big-folder streaming yet — first-chunk-only.) Errors routed through `LogService`.
2. **Dock + overlay shell.** Tiny floating dock on the left edge (one folder icon), click-to-toggle a slide-in panel that tucks fully off-screen when closed, header with title only. No tree yet. Width resizable; dock rides the panel's right edge while open. `⌘⇧E` shortcut + native View menu item.
3. **Tree v1 — render and expand.** Show root contents from `ReadDir`. Empty folders already filtered. Click to expand/collapse. Subtle git-branch decoration on rows where `entry.gitRoot === entry.path`. No selection, no hover-pin yet.
4. **Selection + keyboard nav.** Persistent selection (`aria-selected`), focus ring on icon, arrow keys, Enter to open files (routes through existing `files.openFile`).
5. **Root resolution.** `FindGitRoot` is already in the service from step 1; here we wire the contextual-root computation in the frontend: saved tab → `FindGitRoot(file)` else `dir(file)`; untitled → `$HOME`. No pin yet.
6. **Header buttons + pin / reset.** Header gets `↑ Up` and `⌂ Home` buttons (both pin their target) and the `×` Reset chip (shown only when pinned). Header label reads "Home" when the effective root is `$HOME`. Hover-revealed pin icon on folder rows; clicking the pin on the pinned-root row clears the pin.
7. **Right-click menus.** Register all four in `menu.go` using `emitCommandToCurrentWindow`. Wire commands in `commands/explorer.ts`: `explorer.revealInOS`, `explorer.copyPath`, `explorer.openInNewWindow`, `explorer.newFile`, `explorer.newFolder`, `explorer.rename`, `explorer.refresh`. **No Delete** (deferred to M4). Git variants identical to base initially.
8. **Caching.** Frontend `Map<path, { parentMtime, subfolderMtimes, result }>`. Validity check stats parent + each cached subfolder; on any mismatch, refetch.
9. **Tab `gitRoot` field.** When a tab opens, call `FindGitRoot(filePath)` in a goroutine and set `tab.gitRoot` for future features (diff/history). Internal data only — no visual treatment on tabs in M3.
10. **Click-outside dismissal.** Bind on `mousedown` outside `.explorer-overlay`, excluding context-menu and dialog zones.
11. **Drag to editor.** `Row.ts` becomes drag source for `.md`/`.mdx` rows; ProseMirror plugin `editor/extensions/treeDropHandler.ts` intercepts drops; calls `WorkspaceService.RelativeLinkPath` Go-side (handles Windows + cross-drive); insert as `Link`-marked text at drop position. See [Drag to editor](#drag-to-editor--insert-as-markdown-link).
12. **Polish pass.** Animation timing, focus-ring styling, GitLab-style row interaction, hidden-files filter, non-md filter, custom drag image.

## References

- Tab menu pattern: `menu.go:73-117` (`registerTabContextMenu`, `emitToCurrentWindow`).
- Tab strip context-menu wiring (frontend side): `frontend/src/ui/tabStrip/` — model for `--custom-contextmenu` + `--custom-contextmenu-data`.
- Multi-window service pattern: `windowservice.go` — model for `WorkspaceService`.
- Preferences (do **not** use for window state): `preferences.go`.
- Boot path with `?file=…`: `frontend/src/app/main.ts` — will eventually take `?folder=…` too.
- Tab manager: `frontend/src/app/tabManager.ts` — `newTab({ path, content })` is what file-open routes through; lazy materialization (`defer: true`) applies to multi-open too.
- Mutagen reference for FS API choice: `pkg/filesystem/directory_posix.go`, `pkg/filesystem/directory_windows.go` in <https://github.com/mutagen-io/mutagen>.
