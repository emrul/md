# Lossless hybrid ⇄ WYSIWYG switching (plan)

## Problem

Switching a hard-wrapped document hybrid → WYSIWYG **reflows** it: a paragraph's
manual line breaks (markdown soft-wraps) collapse to spaces, and `_emphasis_`
normalizes to `*emphasis*`. The bytes change, so:

- the tab goes **dirty** on a mere view switch, and
- **saving from WYSIWYG rewrites the file reflowed** — destroying the author's
  line wrapping.

This is the documented sharp edge in [`hybrid.md`](hybrid.md) ("single-line
blocks assumed", "mode switch marks the tab modified… may normalize bytes").
Hybrid itself is lossless (source blocks hold raw markdown); only the
hybrid→WYSIWYG parse and the WYSIWYG serialize lose the original spelling.

Already landed (foundation): dirty is now **content-based** (compare serialized
markdown to the saved markdown) rather than undo-depth-based, so a switch only
dirties when the markdown actually changes. With lossless switching it will
correctly read clean.

## Goal

A block the user has **not edited** keeps its **exact source markdown** across
hybrid ⇄ WYSIWYG and through save. Edited blocks serialize normally. Net: peeking
at WYSIWYG (and back) never reflows or dirties; editing in WYSIWYG only reflows
the blocks actually touched.

## Approach A — per-block raw cache (recommended)

Carry each block's original markdown on the node; reuse it until the block is
edited.

1. **Schema**: add a nullable, model-only `sourceRaw` attribute to `paragraph`
   and `heading` (extend the StarterKit marks; `renderHTML`/`parseHTML` omit it
   so it never hits the DOM or HTML round-trip).
2. **Set it** when raw markdown becomes a WYSIWYG block:
   - `convertToWysiwyg` (mode.ts): when a `sourceBlock`'s raw parses to exactly
     one `paragraph`/`heading`, stamp `sourceRaw = rawText` on it. (Multi-node or
     non-text results fall back to today's reflow — rare.)
   - WYSIWYG load (`hybridLoad`/`setMarkdown` wysiwyg path): stamp each block's
     raw slice the same way.
   - These stamping transactions carry a meta flag so the invalidator (below)
     ignores them.
3. **Invalidate on edit**: a small `appendTransaction` plugin clears `sourceRaw`
   on any `paragraph`/`heading` whose *content* a transaction changed (map step
   ranges → affected blocks). Untouched blocks keep their raw.
4. **Use it** when a WYSIWYG block becomes markdown again:
   - `convertToHybrid` (mode.ts): emit `sourceRaw` verbatim when present, else
     `blockToMarkdown(node)`.
   - **Serialize / save**: the markdown serializer emits `sourceRaw` for a
     `paragraph`/`heading` that has it. *Feasibility to confirm*: tiptap-markdown
     per-node serialize override (extend Paragraph/Heading with a `markdown`
     serialize spec) — the one real unknown; fallback is a post-serialize pass.
5. **Dirty** (already content-based) then reads clean for an unedited switch,
   because `getMarkdown(wysiwyg)` emits the cached raw and equals `savedMarkdown`.

- **Pros**: correct per block — edit one paragraph, the rest keep their wraps.
- **Cons**: schema attribute + invalidation plugin + the serializer hook (the
  risk). Touches load-bearing `mode.ts` / `hybridLoad` / `createEditor`.

## Approach B — document-level snapshot (simpler alternative)

Keep the loaded/saved raw markdown (`savedMarkdown`, already on the tab) and treat
the whole doc as the unit.

- **Dirty**: semantic compare — `normalizeMarkdown(current) === normalizeMarkdown(savedMarkdown)` ⇒ clean (reflow/`_`↔`*` ignored). `normalizeMarkdown` already exists.
- **Save**: when semantically unchanged, write `savedMarkdown` (raw); else write current.
- **Switch back to hybrid**: when semantically unchanged, rebuild from `savedMarkdown` (exact wraps restored) instead of from the reflowed WYSIWYG doc.

- **Pros**: small; no schema; nails the common "peek at WYSIWYG and return" case.
- **Cons**: any real edit in WYSIWYG reflows the **whole** doc (all wraps lost,
  not just the edited block). Restore-on-switch-back needs `savedMarkdown` passed
  from the tab into the conversion (an editor↔app seam).

## Recommendation

**A** if we want it correct under partial edits (the proper fix). **B** if we
want a low-risk win that covers the dominant workflow (work in hybrid, glance at
WYSIWYG, return) and accept that *editing* in WYSIWYG reflows. Both build on the
content-based dirty already in place; the `_`↔`*` normalization is preserved by
either (raw is kept verbatim).

## Out of scope / notes

- Multi-line rendering *inside* a hybrid source block (the block still shows
  collapsed) is a separate follow-up listed in hybrid.md; not required here.
- Source view (CodeMirror) already round-trips raw exactly; unaffected.

## Files (approach A)

- `editor/createEditor.ts` — `sourceRaw` attr on paragraph/heading; register the invalidator plugin.
- `editor/mode.ts` — stamp on convertToWysiwyg, consume on convertToHybrid.
- `editor/serialize/hybridLoad.ts` — stamp on WYSIWYG load.
- new `editor/extensions/SourceRawCache.ts` — invalidation plugin + serialize hook.
- `app/tab.ts` — dirty already content-based; no change beyond what's landed.
