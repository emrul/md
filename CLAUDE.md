# MarkdownMD

A Wails 3 + TipTap markdown editor. Goal: Typora / MarkText-class experience while staying maintainable. Currently in **Milestone 3 (App shell)** — sidebar/file explorer is the active piece.

## Before substantial work, read

- [`../md-pro/docs/architecture.md`](../md-pro/docs/architecture.md) — module layout, state rules, event topology, things we've rejected. Conventions, not a tutorial.
- [`../md-pro/docs/design.md`](../md-pro/docs/design.md) — milestone roadmap (M0–M4). M0, M1, M2 shipped; M3 in progress.
- [`../md-pro/docs/hybrid.md`](../md-pro/docs/hybrid.md) — the everyday-text hybrid editing model (source blocks, 3-way mode, in-place mode switch). Read before touching `editor/mode.ts`, `SourceBlock.ts`, `hybridLoad.ts`, or the mode dropdown.
- [`../md-pro/docs/file-explorer-plan.md`](../md-pro/docs/file-explorer-plan.md) — current milestone target (sidebar).
- [`../md-pro/docs/KNOWN_ISSUES.md`](../md-pro/docs/KNOWN_ISSUES.md) — gotchas worth not re-litigating.
- [`../md-pro/docs/pro-features.md`](../md-pro/docs/pro-features.md) — open-core split: how paid features plug in via the `app/` package + frontend feature registry, and live in the private `md-pro` overlay. Read before touching `app.go`, the `index.ts` barrel, or `features.ts`.

## Load-bearing rules

These are the ones that get violated when you forget them. The full set is in `../md-pro/docs/architecture.md`.

- **Markdown is the source-of-truth.** TipTap is a renderer over the string; never use its AST as the canonical form.
- **Every reachable verb goes through `commands/`.** UI components dispatch through the registry — they don't call business logic directly.
- **Native menus for app chrome; DOM menus only for in-content surfaces.** Wails ContextMenu for tab strip / file explorer; DOM for bubble menu, slash menu, future command palette.
- **Window-scoped emissions for native menu actions.** `app.Window.Current().EmitEvent('command', …)`, never the app-global `app.Event.Emit` for window-targeted actions.
- **One file-open entry point.** Everything routes through `commands.files.openFile` so `useTabs`, dedupe, and lazy-materialization stay enforced.
- **TipTap stays in `editor/`.** UI and services exchange markdown strings, not ProseMirror nodes.

## Project layout

Single Go module rooted at the repo. Root `main.go` is a thin entry shim that owns the `frontend/dist` embed and calls `app.Run(app.Options{…})`; the app assembly and services live in the importable `app/` package (`app.go`, `fileservice.go`, `windowservice.go`, `menu.go`, `preferences.go`, `sessionservice.go`, `workspaceservice.go`). The split exists so the private `md-pro` overlay can import the app — see [`../md-pro/docs/pro-features.md`](../md-pro/docs/pro-features.md). Frontend under `frontend/src/` split into `app/`, `ui/`, `services/`, `commands/`, `editor/`, `styles/`.

Run with `wails3 task dev`. Build with `wails3 task build`. Build artifacts go to `bin/`.
