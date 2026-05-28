# Search index — forward-looking notes

**Status:** Not committed. Post-M3 candidate. This is a scratch doc capturing a discussion on 2026-05-27 about adding a search index for human + AI-agent retrieval. Pick this up after M3 (sidebar + command palette + find/replace + raw-source view + prefs UI) ships.

The decisions in this doc are **tentative**. The only thing we've locked in is the [pinned-root-is-not-indexed-scope](#what-were-locking-in-now) rule, which is captured in `docs/architecture.md`.

## The core idea

A markdown editor for technical design with AI agents needs retrieval that's **block-granular**, **structure-aware**, and **agent-friendly** (returns line ranges suitable for patch generation).

The proposed architecture, in three layers:

1. **Canonical store.** Markdown on disk (already true — see source-of-truth rule).
2. **Index layer.** Markdown AST parsed from the file → block-level rows in SQLite with FTS5.
3. **Optional vector layer.** Embeddings derived from stable section chunks, **not** every keystroke. Hybrid retrieval (BM25 + vector + structural filters) as eventual end state.

The unlock for AI agents is **structure-aware chunks** rather than raw similarity over a doc blob. Agents typically want answers like "the decision about token refresh in the desktop streaming design, including rejected alternatives" — that's a heading path + section retrieval, not a vector similarity hit.

## Phasing (proposed)

- **Phase 1 — SQLite + FTS5 + block-level indexing.** Local-first, transactional, portable. Good-enough search; substrate for everything else.
- **Phase 2 — LLM query expansion and reranking.** Same index; add a thin LLM-side layer that rewrites queries and reorders FTS hits.
- **Phase 3 — Embeddings on stable section chunks.** Selective, not exhaustive. Probably `sqlite-vec` or LanceDB. Triggered on save, not keystroke.
- **Phase 4 — Hybrid retrieval.** BM25 + vector + structural filters (`block_type = decision AND heading_path includes "auth"`).

## Index shape (sketch)

```text
SQLite:
  documents(id, path, mtime, ...)
  blocks(id, doc_id, parent_heading_path, block_type, plain_text,
         markdown_text, line_start, line_end, updated_at, embedding_id?)
  links(from_block_id, to_doc_id, to_block_id?, label)
  symbols(name, kind, doc_id, block_id)
  fts_blocks USING FTS5 (content table over blocks.plain_text)
```

Block-level granularity. Each row carries enough metadata for an agent to (a) find the right block via FTS, (b) read the markdown text, (c) patch the file at the given line range.

## Block identity — three options, in increasing complexity

| Option | What it is | Pros | Cons |
|---|---|---|---|
| **Heading-path + line range** | `doc + heading_path + (line_start, line_end)` is the identity | No editor changes; survives the markdown-only stack as-is | Identity shifts as lines change; OK for FTS rows (stale rows get superseded), unstable for cross-document refs |
| **Content hash** | Stable hash over normalised block text | No editor changes; survives moves | Any edit creates a "new" block — agents can't track edits across revisions |
| **Explicit IDs** | HTML comments (`<!-- id: dec_abc -->`) or `:::directive id="..."` attributes baked into the markdown | Stable across edits and moves; cross-doc refs work | Pollutes the file; needs editor support to preserve / generate / hide |

**Recommendation:** start with **heading-path + line range**. Defer explicit IDs until cross-doc references prove necessary. Hashes are fine as a tiebreaker but not a primary key.

## Custom directives — push back on doing them speculatively

The ChatGPT proposal suggests adding markdown directives like:

```md
:::decision
We will use SQLite FTS5 for local search.
:::

:::constraint
Search must work offline.
:::

:::question
Should embeddings be generated locally or via hosted API?
:::
```

Each directive becomes a `block_type` in the index, enabling queries like "all open questions in this project."

**Don't ship these speculatively.** Each one is real editor work:
- A TipTap node (and possibly NodeView for non-trivial rendering)
- A markdown-it parser plugin
- A tiptap-markdown serializer override (so round-trips preserve the directive cleanly)
- UI affordance (BubbleMenu / slash-menu entry)
- An indexing semantic (where in the AST does it show up, what counts as its content)

That's M2.4-scale work *per directive type*. Five directives = a milestone.

**Start with the AST-free block types** — `paragraph`, `heading`, `code`, `quote`, `list_item`, `table`, `math` — which any markdown parser gives you for free. Add directives only when actual retrieval pain forces it ("I keep grepping for 'we decided' to find decisions"). The pain may never come; if it does, directives are *additive* over a system that already has solid block-level retrieval.

## Live editing — index updates

Don't reindex whole documents per keystroke. The flow:

1. Editor change → debounced (say 500ms after idle).
2. Diff dirty range from previous serialized markdown to current.
3. Reparse the affected file; AST-diff against the indexed blocks.
4. Update only the blocks that changed.

Stable block identity (heading-path + line range) makes "what changed" answerable without storing the entire previous AST.

External file changes (via fsnotify, once it lands) trigger the same flow.

## Architectural fit with existing modules

The search index slots cleanly into the existing layering — no rework of what we've already built.

```
Go:
  searchservice.go        NEW. SQLite handle, FTS5 setup, indexer goroutine,
                          incremental update API.
  workspaceservice.go     UNTOUCHED.
  fsnotify (future)       NEW. Shared dispatcher: explorer cache + search index
                          both subscribe.

Frontend:
  services/search.ts      NEW. IPC wrapper.
  ui/searchPalette/       NEW. The search surface (reuses command-palette
                          patterns from M3).
  commands/search.ts      NEW. search.openPalette, search.runQuery, etc.
  app/                    UNTOUCHED.
  editor/                 UNTOUCHED (unless / until custom directives ship).
```

The architecture rules from `docs/architecture.md` apply unchanged. No new module-layer concepts needed.

## fsnotify becomes load-bearing

We deferred fsnotify for the explorer because manual refresh + window-focus soft refresh is enough for navigation. For an *index*, "stay current" isn't optional — stale results poison agent retrieval.

When fsnotify lands, it should be a **single Go-side dispatcher** that both the explorer cache and the search index subscribe to. Don't ship two separate watcher implementations.

## What we're locking in now

The one decision worth committing to before the rest is scoped:

**The explorer's pinned root is NOT the indexed scope.** They're different concepts: per-window navigation aid (transient) vs project-wide retrieval scope (persistent). Different lifetimes, different UX, separate state. Captured as a rejection in `docs/architecture.md`.

Naming for the indexed scope — "project", "vault", "library" — left open. Whatever it ends up being, it's not `pinnedRoot`.

## Sequencing

Current trajectory:
- **M3 in progress** — sidebar (active), then command palette, find/replace, raw-source view, prefs UI.
- **M4 planned** — themes, autosave, export.

Search-indexing-with-AI-retrieval is meaty — comparable in scope to M3 itself. Two reasons to land it *after* M3:

1. Command palette + find/replace (both M3) will reuse the same UI patterns the search panel needs (modal palette, results list, keyboard nav, snippet highlighting). Building them first means search UX gets a head start.
2. M3 settles the editor's per-document state; M4-or-later can take on the project-wide layer once the per-document layer is stable.

Likely landing as **M5** (own track) rather than folded into M4 polish.

## Open questions to revisit when committing

- Where does the SQLite database live? Per-project file (`.markdownmd/index.db`), per-app cache (`<configHome>/MarkdownMD/index.db`), or both?
- One index per project, or one global index with project filtering?
- Embedding model: local (e.g., Nomic / all-MiniLM) or hosted? Local plays better with the offline-first stance.
- Schema migration story when block_type vocabulary grows.
- How much of the index lives in the editor's tab object vs the central index (e.g., does the active tab pre-cache its own blocks for instant find-in-doc)?

## Reading list

- [Tiptap export to JSON / HTML](https://tiptap.dev/docs/guides/output-json-html) — relevant if we ever pivot to AST-from-TipTap.
- [Tantivy](https://github.com/quickwit-oss/tantivy) — alternative to SQLite FTS5 if search becomes first-class.
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — embedded vector store, sits inside SQLite.
- [LanceDB](https://github.com/lancedb/lancedb) — embedded vector-native DB.
- The original ChatGPT exchange that started this discussion (link in chat history, 2026-05-27).
