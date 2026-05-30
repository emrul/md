# Hybrid editing model

How the "everyday-text" hybrid mode works — the MarkText/Typora-style live preview where each top-level text block shows rendered markdown at rest and its raw syntax when the caret is in it.

A design doc, not a tutorial. Code in `main` is authoritative; if this disagrees with the code, the code wins — update this. See also [`architecture.md`](architecture.md) ("markdown is source-of-truth") and [`design.md`](design.md).

## What it covers

Three user-facing modes, chosen per tab via the toolbar dropdown and seeded from the `editorMode` preference (`wysiwyg | hybrid | source`):

- **WYSIWYG** — pure TipTap. No raw syntax ever shown.
- **Hybrid** — top-level paragraphs/headings are *source blocks*: rendered at rest, raw markdown when the caret enters.
- **Source** — raw markdown in a CodeMirror overlay (owned by the ViewController, not a schema concern).

What hybrid renders *inline* inside a source block, live:

| Construct | At rest (idle) | Caret inside (active) |
|---|---|---|
| `# … ######` | sized heading, no `#` | `#` shown dimmed |
| `**b**` `__b__` | bold | markers dimmed |
| `*i*` `_i_` | italic | markers dimmed |
| `~~s~~` | strikethrough | markers dimmed |
| `` `c` `` | inline code | backticks dimmed |
| `[t](url)` | styled link (url hidden) | full syntax dimmed |
| `$x$` | KaTeX-rendered | raw `$x$`, `$` dimmed |

**Still WYSIWYG in hybrid** (rendered containers, nested content keeps real marks): lists, task lists, tables, fenced code blocks, block math (`$$…$$`), blockquotes, horizontal rules, images. Only *top-level* paragraphs and headings become source blocks; nested text (list items, quote bodies, table cells) is untouched. See "Future work."

## One schema, mode derived from the document

Both editor modes share a single schema, so switching never rebuilds the editor (undo survives). The schema always includes the `sourceBlock` node and a custom `doc` whose content is `(sourceBlock | block)+` — listing `sourceBlock` first makes it the `ContentMatch` default, so empty docs / Enter / refills produce source blocks (the common hybrid case) while any block is still allowed anywhere. Nested containers pin `paragraph` explicitly, so they're unaffected. See `editor/createEditor.ts`.

The render mode is **derived from the document**, not stored: a top-level `sourceBlock` ⇒ hybrid, a top-level `paragraph`/`heading` ⇒ wysiwyg, otherwise hybrid (default). See `getRenderMode` in `editor/mode.ts`.

**Why derive it:** a stored flag drifts out of sync with the doc on undo/redo. Deriving it means undo/redo move content *and* mode together, and a switch is just a normal transform.

## The source block

`editor/extensions/SourceBlock.ts`. Node `sourceBlock`: `content: 'text*'`, `marks: ''`, `code: true`.

**Why `code: true`:** it makes the block hold literal text — TipTap input rules don't fire inside it, so typing `# ` or `**x**` stays raw instead of becoming a heading node or a bold mark. The cost is that the base keymap treats Enter as a newline, so the block overrides `Enter` to split into a *new* source block.

Markdown serialization just writes `node.textContent` (the block already holds raw markdown), so source view and copy/paste round-trip exactly.

## Inline rendering = decorations, not nodes

A single ProseMirror plugin (`decoKey`) computes a `DecorationSet` over every `sourceBlock`. No marks, no node-views, no DOM swaps — the block's text is always the raw markdown; decorations restyle it:

- **Idle** (caret elsewhere): markers (`#`, `**`, `[`, `](url)`, `$…$`) get `sb-marker sb-hidden` (`display:none`); inner text gets its style class (`sb-bold`, `sb-link`, …). Inline math additionally hides the raw `$…$` and adds a KaTeX **widget** decoration in its place.
- **Active** (caret in block): markers shown dimmed (`sb-marker`), inner text still styled. Math shows raw with dimmed `$`.

Headings also get an `sb-h{level}` node decoration sizing the whole block. Patterns and the heading/link/math regexes live at the top of `SourceBlock.ts`; styling in `editor/extensions/source-block.css`. Inline math rendering is `renderInlineMath` in `editor/extensions/Math.ts` (KaTeX `renderToString`, cached by latex).

### Caret stability on entry

Revealing markers reflows text, which would paint the caret at a stale spot. Entry is **two-phase**: on the transaction that moves the caret into an idle block, reveal the markers and bounce the caret back this frame, then place it next frame (rAF). Vertical (up/down) entry additionally re-targets via `posAtCoords` against the revealed layout so the caret keeps its column. This is the hard-won core of the original spike; don't "simplify" it without re-testing arrow/click entry.

## Loading markdown → source blocks

`editor/serialize/hybridLoad.ts` (`setHybridMarkdown`). `setMarkdown` routes here when the mode is hybrid (`editor/serialize/markdown.ts`).

1. `setContent(md)` to get the normal WYSIWYG doc.
2. Re-tokenize the *same* source with markdown-it (`storage.markdown.parser.md`) to get the ordered top-level block stream; each block's open/leaf token carries a `[startLine, endLine)` map.
3. Replace each top-level `paragraph`/`heading` with a source block sliced from the **raw** source (syntax preserved exactly); leave tables/lists/code/blockquotes as parsed.

Two safety guards fall back to the plain parse (no source blocks) rather than risk corruption:
- block count must equal the doc's child count (1:1), and
- every non-blank source line must be covered by a top-level block.

The second guard catches orphan lines (link/footnote reference definitions, front matter, raw HTML) that carry no block token — slicing per block would drop them, so we keep the plain parse instead.

## Switching modes in place

`switchRenderMode` / `convertToWysiwyg` / `convertToHybrid` in `editor/mode.ts`. Each is a **single transaction** that replaces the doc's top-level content:

- hybrid → wysiwyg: each source block's raw text → paragraph/heading nodes (markdown → HTML via `parser.parse`, then `DOMParser.fromSchema`).
- wysiwyg → hybrid: each paragraph/heading → a source block holding its markdown (serialize a throwaway one-block doc; per-node serialization drops markers, a one-block doc doesn't).

The switch calls `closeHistory(tr)` so it's its own sealed undo step. **Why:** an `addToHistory:false` full-document `replaceWith` makes ProseMirror remap *prior* undo steps through a total replacement — that corrupts undo. A sealed, undoable step means one ⌘Z reverts the switch (mode follows because it's derived), and edits before/after undo independently.

Source ⇄ editor transitions go through the ViewController (`app/viewMode.ts`): entering source serializes the editor to CodeMirror; exiting rebuilds the editor via `setMarkdown(text, targetMode)`.

## Formatting writes syntax

In a source block there are no marks, so `format.bold/italic/strike/code` and the heading commands wrap/toggle literal syntax instead (`toggleSourceWrap`, `toggleSourceHeading`). The branch is in `commands/index.ts` (`inSourceBlock` → source command, else the normal TipTap toggle), so the toolbar, bubble menu, and ⌘B/⌘I/⌘E all work in both modes. Links open on ⌘/Ctrl-click via `editor/extensions/LinkOpen.ts` (resolves WYSIWYG link marks *and* source `[t](url)`; opens `http/mailto/tel`).

## Constraints and sharp edges

- **Single-line blocks assumed.** A soft-wrapped paragraph loads as one source block with embedded `\n`; it round-trips, but renders visually collapsed (the block isn't `white-space: pre`). Heading detection is first-line only.
- **`_` normalizes to `*`** once content passes through real marks (any WYSIWYG or source round-trip). Semantically identical; hybrid renders both. Raw is preserved as long as a block never leaves hybrid.
- **Mode switch marks the tab modified** — it dispatches a doc transaction (and may normalize bytes).
- **Emphasis chars inside `$…$` or a URL** can cosmetically mis-style the *raw* source when the block is active (idle hides it). Rare; accepted.
- **Setext headings** (`===`/`---` underline) aren't recognized by the `#`-based decoration — they render as plain text but round-trip fine.
- **Table-only / no top-level text doc** is mode-ambiguous; `getRenderMode` defaults to hybrid.
- **Test harness runs in Blink** (`frontend/harness.html`, `npm run harness`), not WKWebView — authoritative for logic/decorations/selection, but WebKit paint quirks still need a real `wails3 task dev` check.

## Future work

The deferred pieces all share one shape: **bring nested text into the source-block model.** Today list items, task items, and blockquote bodies render as WYSIWYG containers whose inner text is a real `paragraph` with marks, so clicking them doesn't reveal source the way top-level text does.

The MarkText-consistent approach is to keep the *structure* WYSIWYG (bullets, numbers, checkboxes, quote bar, indentation — these serialize tight/loose correctly via tiptap-markdown) but make each item's/quote's *text* a source block. That needs:

1. Schema: `listItem` / `taskItem` / `blockquote` content allows a `sourceBlock` where it currently requires `paragraph`.
2. Load + mode-switch conversion to route nested paragraphs through the source-block path.
3. Careful round-trip verification — especially tight vs. loose lists, where naive per-line blocks serialize with blank lines and drift loose. This is the main risk and the reason it's deferred.

Decided **not** to do yet (lists/tasks/blockquotes stay WYSIWYG): the gain is editing-consistency, the cost is schema surgery plus round-trip risk against "markdown is source-of-truth."

Smaller follow-ups: setext→ATX normalization on load, multi-line/soft-break rendering inside a block, in-app navigation for relative/anchor links, and excluding `$…$`/URL interiors from emphasis decoration.
