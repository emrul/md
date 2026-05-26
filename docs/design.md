# Plan: TipTap editor → Typora/MarkText-class experience

## Context

The current editor at `/Users/emrul/dev/emrul/md/MarkdownMD` is a working but minimal Wails 3 + TipTap setup: ~340 lines of vanilla JS in `frontend/src/main.js`, StarterKit + a custom MermaidCodeBlock, 14-button toolbar, basic File/Format menus, and word/char/line counts. The goal is to grow it into a refined editing experience comparable to Typora and MarkText — the same WYSIWYG-with-markdown-syntax-revealed feel, with rich blocks (syntax-highlighted code, tables, math), an IDE-style app shell (sidebar, tabs, command palette), and a polished settings/theming layer.

MarkText itself is being phased out as a reference codebase (its Muya engine is hard to maintain), so we are *not* porting MarkText's internals — we are matching its UX on top of TipTap.

## Direction (confirmed with user)

- **Phasing**: milestone-based, narrow and deep. Each milestone ships demo-able quality before moving on.
- **Codebase shape**: migrate to TypeScript and modularize during Milestone 0. TipTap's API is heavily typed and custom extensions benefit enormously from TS.
- **Coverage**: all four areas are in scope — editing feel, rich blocks, app shell, polish — sequenced over milestones.
- **Source vs WYSIWYG**: **hybrid live-preview** is the target experience — the markdown source IS the rendering, with syntax markers revealed contextually. Reveal granularity is **whole-line / whole-block on cursor** (MarkText/Obsidian Live Preview behavior). A **true raw-source view** (CodeMirror 6) is also included for power-user tasks (regex find/replace, etc.), toggled with a shortcut. Implementation approach: **go big from the start** — build the decoration plugin covering all inline marks and block prefixes in one milestone, not a partial spike.

## Architecture target

```
MarkdownMD/frontend/src/
  app/                      # bootstrap, app shell wiring
    main.ts                 # entry, replaces current main.js
    ipc.ts                  # thin wrapper over Wails bindings
  editor/
    createEditor.ts         # TipTap instance factory
    extensions/
      core/                 # re-exports of StarterKit pieces we keep
      blocks/               # CodeBlockLowlight, Table, Math, TaskList, Mermaid, …
      marks/                # custom marks if needed
      ui/                   # BubbleMenu, FloatingMenu, SlashMenu
      hybrid/               # decoration plugin for source-reveal (see Milestone 1)
    serialize/              # tiptap-markdown config + custom serializers
  ui/
    toolbar/                # main toolbar
    sidebar/                # file tree, search, TOC panels
    tabs/                   # multi-file tab strip
    statusbar/              # word count, mode indicators
    commandPalette/         # Cmd+Shift+P
    findReplace/            # in-editor find/replace
    dialogs/                # settings, export, etc.
  commands/                 # central command registry (id, label, keybinding, handler)
  services/
    files.ts                # file I/O via Wails
    workspace.ts            # open folder, watcher, recents
    settings.ts             # preferences store
    themes.ts               # theme registry + CSS variable application
  styles/
    tokens.css              # design tokens (colors, spacing, type scale)
    themes/                 # light.css, dark.css, …
```

## Milestone outline (incremental, each shippable)

### Milestone 0 — Foundation (1–2 days)
- Add TypeScript, ESLint, Prettier; rename `main.js` → `main.ts`.
- Carve out the folder structure above; move current logic into `app/`, `editor/`, `services/files.ts`, `ui/toolbar/`, `ui/statusbar/`.
- Introduce a command registry (`commands/index.ts`) — every action (toolbar button, menu item, shortcut) goes through it. This becomes the substrate for the command palette later.
- Verify the existing app still works end-to-end after the refactor.

### Milestone 1 — Editing feel (the Typora moment)
Anchor milestone. Goal: opening the app and typing should already feel different.

**Hybrid live-preview decoration plugin** (`editor/extensions/hybrid/`):
- Custom ProseMirror plugin that listens to selection changes and emits a `DecorationSet`.
- For every line/block intersecting the selection (or containing the cursor), inject **inline widget decorations** that render the markdown markers as muted-styled spans: `**` around bold ranges, `_` around italic ranges, `` ` `` around inline code, `~~` around strike, `[text](url)` reconstructed around link marks, leading `# ` / `## ` for headings, `> ` for blockquote lines, `- ` / `1. ` for list items, ``` ``` ``` fences for code blocks, `$...$` / `$$...$$` for math.
- Lines/blocks outside the active selection render clean (no markers).
- The plugin owns the styling tokens (one CSS variable for marker color) so theming can recolor in Milestone 4.
- Edge cases to handle: nested marks (bold-italic), marks crossing line boundaries, empty paragraphs, soft-breaks, code blocks (no inline-mark reveal inside them), tables (cell-by-cell reveal scope).

**Surface UI:**
- **BubbleMenu** on selection — bold, italic, inline-code, strike, link, clear-formatting.
- **FloatingMenu / slash insert** on empty lines — insert heading, list, task list, code block, table, math, image, hr, mermaid.
- TipTap's built-in InputRules for `#`, `-`, `>`, ``` ``` ```, `---` continue to work (already partly working via StarterKit).
- Keyboard shortcuts wired through the command registry (Cmd+B/I, Cmd+Shift+K code block, Cmd+Opt+H highlight, Cmd+Shift+T table, etc.).

**Acceptance sketch:** type `# Hello **world**`, see styled heading with `# ` and `**` markers visible while cursor on line; click into a paragraph below, the first line's markers vanish.

### Milestone 2 — Rich blocks
- Replace the StarterKit code block with **CodeBlockLowlight** + language picker UI (dropdown or slash-arg) and a curated language set.
- **Tables**: `@tiptap/extension-table`, `Table*Cell`/`*Header`/`*Row`; hover toolbar for add/delete row/col; resizable columns.
- **KaTeX math**: inline `$...$` and block `$$...$$` via a custom Mathematics node (TipTap Pro extension or community port).
- **Task lists**: `@tiptap/extension-task-list` + `task-item`.
- Verify existing Mermaid block still renders; consider promoting it to a "diagram" node that can dispatch by language (mermaid/plantuml/flowchart later).

### Milestone 3 — App shell
- **Sidebar** (collapsible left pane, ~260px):
  - **Files**: workspace folder tree via a new Go file-tree service; expand/collapse, rename, drag-reorder later.
  - **Search**: ripgrep-backed full-workspace search (Go side); result list links to files.
  - **TOC**: live outline derived from current doc's heading tree.
- **Tabs strip** above the editor: multi-file editing, dirty-dot indicator, middle-click close.
- **Command palette** (Cmd+Shift+P): fuzzy filter over the command registry with shortcuts displayed inline.
- **Find/replace** in-editor (Cmd+F / Cmd+Opt+F) — ProseMirror search-replace plugin or custom.
- **Raw-source view toggle** (Cmd+/) — swaps the TipTap view for a CodeMirror 6 raw-markdown editor. Sync on toggle (serialize TipTap → markdown on enter; parse markdown → TipTap on exit). Markdown is the source of truth, so no live two-way sync needed.
- **Focus mode** (dim non-current paragraph) and **typewriter mode** (keep caret mid-screen) — both small CSS + scroll handlers.

### Milestone 4 — Polish
- Theming: design tokens + light/dark theme; system-preference sync; user-selectable in settings.
- Settings panel (modal): font, font size, line height, autosave interval, spellcheck, theme.
- Autosave timer + dirty-close confirmation (window close hook on the Go side).
- Recent files menu (persisted via Wails settings storage).
- Export to HTML and PDF (HTML by serializing to a styled template; PDF via Wails' embedded webview print or a Go-side puppeteer-equivalent — TBD).
- Image paste/drag: save into a workspace `assets/` folder, insert relative-path image markdown.

## Critical files to touch

- `MarkdownMD/frontend/src/main.js` → replaced by `app/main.ts` (Milestone 0).
- `MarkdownMD/frontend/src/style.css` → split into `styles/tokens.css` + per-component CSS (Milestone 0).
- `MarkdownMD/frontend/index.html` → leaner shell, mount points only.
- `MarkdownMD/frontend/package.json` → add TS + TipTap extensions per milestone.
- `MarkdownMD/main.go` and `MarkdownMD/fileservice.go` → add workspace/folder/search/watcher services (Milestone 3).
- New: everything under the architecture target tree.

## Verification approach

Per milestone:
- Build via `wails dev` and confirm the prior features still work.
- Manual sweep of editing surfaces: type each markdown construct, confirm transform; round-trip save/load.
- For Milestone 1: a checklist of "type X → see Y" scenarios run by hand.
- For Milestone 3: open a real folder (e.g. `~/notes` or this plans/ directory), tab through files, run a search, click TOC entries.
- Type-check (`tsc --noEmit`) and lint clean on every milestone.

## Risks & deferred decisions

- **KaTeX math extension choice**: TipTap's official Mathematics extension is part of TipTap Pro (paid license). Community alternatives exist (`@aarkue/tiptap-math-extension`, custom node wrapping KaTeX). Decide during Milestone 2 once we have the codebase in TS.
- **Diagrams beyond Mermaid** (PlantUML, flowchart.js, vega-lite): defer past Milestone 4 unless explicitly requested.
- **PDF export mechanism** (Milestone 4): Wails-side print API vs JS-side library (e.g. html2pdf, puppeteer-via-Go). Decide during Milestone 4.
- **Hybrid plugin edge cases**: nested marks, soft-breaks, and table-cell scoping are the riskiest parts of Milestone 1. If a particular case proves intractable, fall back to "always show markers in code/table cells" rather than spending unbounded time on it.

## Memory note

Save a `project` memory after Milestone 0: "MarkdownMD codebase is TypeScript + Wails 3, structured under `frontend/src/{app,editor,ui,commands,services,styles}`; central command registry routes all actions; hybrid live-preview is the editor's signature feature."
