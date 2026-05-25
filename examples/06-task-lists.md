# Task lists

GitHub-flavoured task lists. `- [ ]` is an open task, `- [x]` is checked. Each item gets a clickable checkbox — click it to toggle without moving the cursor. The text strikes through when a task is done.

## Things to ship this week

- [x] Wire CodeBlockLowlight + language picker
- [x] Re-render mermaid on demand (avoid the destroy loop)
- [ ] Task lists (this milestone)
- [ ] Tables with hover toolbar
- [ ] KaTeX math node
- [ ] Update the kitchen-sink example to include the new blocks

## Nested tasks

- [ ] Research
  - [x] Read MarkText source briefly
  - [x] Read TipTap docs for tables
  - [ ] Pick a math approach (decided: custom KaTeX node)
- [ ] Implementation
  - [ ] Tables: `@tiptap/extension-table`
  - [ ] Math: inline + block nodes wrapping KaTeX
  - [ ] Hybrid-reveal integration for `$…$` markers

## Mixed with regular text

A paragraph can sit next to a task list. Useful when a task needs a longer description than fits on one line.

- [ ] **Important:** ship a working build before the freeze on 2026-06-01
- [ ] Optional polish — make the language picker filter case-insensitive (already does — leave a note)

## What to try

- Click a checkbox — the row strikes through, cursor stays where it was.
- Press `Tab` inside a task item to nest it; `Shift+Tab` to unnest.
- Use `⌘⇧9` to toggle the current line in/out of a task list.
- Type `/task` to insert a fresh task list from the slash menu.
- Save with `⌘S`, reopen — `[x]` / `[ ]` survive round-trip via tiptap-markdown.
