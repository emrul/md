# MarkdownMD architecture

A conventions doc. Each section is one rule plus the *why*. If you find yourself wanting to violate a rule, the why tells you whether the rule needs updating — it doesn't tell you it's OK to silently break it.

Code in `main` is authoritative; this doc captures intent. If they disagree, this doc is stale — update it.

## Module layout

```
Go (project root)
├── main.go                bootstrap, service wiring
├── menu.go                native menus + context menus
├── fileservice.go         file I/O (open/save/rename)
├── windowservice.go       multi-window operations
├── workspaceservice.go    (M3) filesystem listing, git detection
└── preferences.go         app-global persisted preferences

frontend/src
├── app/         per-window state, lifecycle, bootstrap
├── ui/          DOM components — no state ownership
├── services/    IPC over Wails + frontend-side caches
├── commands/    verb registry; every action registers here
├── editor/      TipTap and ProseMirror — quarantined
└── styles/      design tokens + themes
```

The boundaries matter more than the names. `app/` owns the in-memory model of "what is this window currently looking at." `ui/` translates that model to DOM and dispatches user intents back through commands. `services/` is the only module that talks to Wails service bindings. `commands/` is the named verbs the app can perform.

This separation has concrete payoff: a future persistence layer subscribes to `app/`, not `ui/`. A future command palette enumerates `commands/`, not `ui/`. Theme refactors touch `styles/` and nothing else.

## The command registry is the spine

Every reachable verb in the app — menu item, keyboard shortcut, right-click action, future command-palette entry — registers in `commands/` and is dispatched through it.

UI components do not call business logic directly. A toolbar button dispatches `format.bold`. A native menu item emits a `command` event carrying the verb ID. A right-click menu emits `command` with the verb ID *and* a path argument carried via `--custom-contextmenu-data`.

The registry accepts arguments where needed (e.g., `explorer.delete(path)`). Argument support is part of the contract; don't bypass the registry to hand-roll something with args.

**Why:** single source of truth for what the app can do. Substrate for the command palette. Centralizes keyboard-shortcut and (eventually) accessibility plumbing. Makes "what can this app do?" inspectable instead of scattered.

## Event topology

Three channels, each with a specific job.

| When | Mechanism |
|---|---|
| Frontend asks Go for data | Wails-bound service methods (`WorkspaceService.ReadDir(...)`) |
| Go streams data back per request | Window-scoped emissions, namespaced by request ID (`dir-batch:<id>`) |
| Native menu invokes a verb | `app.Window.Current().EmitEvent('command', verbID, data)` — window-scoped |

Truly app-global events (no specific window) are rare. Default to window-scoped.

**Why:** keeps multi-window state from leaking across windows. Allows in-flight cancellation per window. Future window-state restore doesn't have to untangle global state.

## Window scoping for native menu actions

`menu.go` handlers use `app.Window.Current().EmitEvent(...)`, never `app.Event.Emit(...)` for window-targeted actions. The frontend filters incoming events by `event.sender === await Window.Name()`.

**Why:** with multi-window, an unscoped emit fires the handler in every open window. Right-clicking "Close Tab" in window A would close the corresponding tab in window B. Established by `registerTabContextMenu`; preserved everywhere new.

## State location rules

| Lifetime | Home |
|---|---|
| In-memory, per-window, ephemeral | `frontend/src/app/<thing>State.ts` (e.g., `tabManager.ts`, `explorerState.ts`) |
| Persisted, per-window | (future) per-window state file at `<configHome>/MarkdownMD/windows/<windowId>.json` |
| Persisted, app-global | `preferences.toml` via `PreferencesService` |
| Cached over a process lifetime | `frontend/src/services/<thing>.ts` (e.g., explorer's directory cache) |

Don't put per-window state in `preferences.toml`. Don't put app-global state in `app/<thing>State.ts`. Don't park user data in a frontend cache and treat the cache as authoritative.

**Why:** the future window-state work depends on this split. Mixing them creates a migration nightmare and surfaces "why is my unrelated window's sidebar width changing?" bugs.

## Markdown is source-of-truth

The markdown string is canonical. TipTap is a renderer over the string. A future CodeMirror 6 raw-source view will also be a renderer over the string.

Round-tripping content through TipTap's AST and back is **not safe** — it can drop or normalize formatting in ways the user didn't intend. When two views need to be in sync (TipTap and raw-source, for example), the markdown string is the bridge, and both views derive from it.

**Why:** ProseMirror is a tree; markdown is a string. Each can represent things the other can't. Canonicalizing on the string keeps the user's bytes intact and keeps view-swap simple.

## Native menus over DOM menus for app chrome

The application menu is built with Wails native menus (`menu.go`). Context menus — tab strip, file explorer — are also native Wails ContextMenu, registered up front in `menu.go`. DOM-rendered context menus are not used for app chrome.

DOM popups *are* fine for in-content surfaces: TipTap BubbleMenu, slash menu, table toolbar, code-block language picker, the future command palette. The line is: chrome is native, content is DOM.

**Why:** native menus pick up OS roles (Cut/Copy/Paste on macOS), system accessibility, and look-and-feel for free. DOM equivalents inevitably feel off — wrong fonts, wrong dismissal semantics, wrong keyboard handling on Linux GTK.

Wails 3 native context menus can't be reconfigured per right-click — register multiple variants by name and let the frontend pick via `--custom-contextmenu`. See `registerTabContextMenu` for the pattern.

## File I/O routes through one entry point

To open a file: `commands.files.openFile(path)`. To open multiple files: the same path with a list. Do not reach into `tabManager.newTab` directly from UI code.

The single entry point enforces invariants — respect `useTabs` preference, dedupe already-open paths, lazy-materialize all-but-the-last in multi-open, set window title, etc. Each invariant violated is a bug that's hard to find later.

Similarly: native file dialogs (Open, Save, Save As) go through `FileService`, not through Wails dialog primitives sprinkled around.

**Why:** any path that bypasses the entry point will silently miss future invariants added there. Bug factory.

## TipTap is quarantined to `editor/`

Only `editor/` imports from `@tiptap/*` or `prosemirror-*`. UI components, services, and commands receive and emit markdown strings (or higher-level domain types), not TipTap nodes or ProseMirror transactions.

The bubble menu UI lives in `ui/` and calls into `editor/` through a typed facade. It does not import `@tiptap/extension-*` chains directly.

**Why:** swapping editors (or running the raw-source view in parallel) becomes refactor-impossible if TipTap leaks across modules. Also: TipTap's API churns release-over-release; isolating it limits blast radius.

## Things we've explicitly rejected

- **DOM context menus for chrome.** Tab strip and file explorer use native Wails menus. See "Native menus over DOM" above.
- **VUI for menubar / toolbar / statusbar.** Vanilla DOM + native menus instead. VUI may surface later for settings dialogs and similar surfaces.
- **Multiple file-open entry points.** Everything routes through `commands.files.openFile`.
- **Per-window state in `preferences.toml`.** Future per-window state file is its own home.
- **Recursive scans for "is this useful?" questions** (e.g., "does this folder contain markdown anywhere below?"). One-level scans only — see `docs/file-explorer-plan.md`'s piggyback design.
- **fastwalk / godirwalk** for filesystem traversal. Stdlib `os.ReadDir` with `DirEntry.Type().IsDir()` is sufficient; Mutagen does the same. See `docs/file-explorer-plan.md` references.
- **Conflating the explorer's pinned root with a future indexed scope.** The pinned root is a per-window navigation aid (transient, ephemeral); an indexed scope — when a search index is introduced — is a project-wide retrieval scope (persistent, curated). Different lifetimes, different UX, separate state. They share the conceptual space of "a directory you care about" but are not the same concept. See `docs/search-index-notes.md`.

## When in doubt

Pick the boundary that lets you change one module without touching the others. If a change requires touching three modules, the boundary is probably wrong — find the missing seam (often a new command, a new event, or a new service method) and route through it.
