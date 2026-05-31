# Local markdown link preview & navigation (plan)

Preview and open **local markdown links** from inside the editor — in both
WYSIWYG and hybrid views — reusing the explorer's file-preview machinery and the
existing link-resolution plumbing. Completes the "in-app navigation isn't wired
yet" TODO in `editor/extensions/LinkOpen.ts`.

## UX

- **Preview (dwell):** hover a local `.md` link for ~700ms → a popover with the
  target's title (first heading, else filename) and first ~4 content lines, the
  same content/positioning the explorer already shows. Flips to stay on-screen;
  dismisses on mouse-out, scroll, selection change, or blur. Only local `.md`
  links arm it (cheap JS pre-filter), so ordinary prose hovering is silent. No
  modifier key.
- **Open (⌘/Ctrl-click):** the existing open gesture, extended to local `.md`
  links — resolve the target and route through `commands.execute('files.openPath',
  { path })`. `openPath` already dedupes: **switch to the tab if the file is
  already open, otherwise open a new tab.** Absolute links (`http/mailto/tel`)
  keep opening in the system browser as today.
- **Both views:** WYSIWYG rendered `<a>` / link-marks, and hybrid source-block
  literal `[text](./x.md)`. Same dual lookup `LinkOpen` already uses — anchor
  element's `href`, else `posAtCoords` → `linkHrefAt`.

## What counts as a "local md link"

A cheap JS pre-filter on the href (no IPC, safe to run on mouse-move):

- Not absolute — fails `/^(https?|mailto|tel):/i`.
- After stripping `#fragment` / `?query` and URL-decoding, the path ends in
  `.md` / `.markdown` / `.mdx` (case-insensitive). `file://` targets that are
  `.md` count too.

Resolution and existence are confirmed **in Go**, and only *after* the dwell
fires or on click — never on every mouse-move.

## Path resolution (Go)

New `WorkspaceService.ResolveLink(fromFile, href) (ResolvedLink, error)` — the
inverse of the existing `RelativeLinkPath`:

- `fromFile` = the current tab's `filePath` (the link's base). Empty for Untitled
  → relative links have no base → `{Exists:false}`; `file://` absolute hrefs
  still resolve.
- href handling: URL-decode (matches `encodeHref` on the insert side), strip
  `#fragment`/`?query`, then:
  - `file://` URL → OS path (inverse of `fileURL`: `file:///D:/foo` → `D:\foo`,
    `file:///foo` → `/foo`).
  - absolute (`filepath.IsAbs`) → as-is.
  - relative → `filepath.Join(filepath.Dir(fromFile), href)` then `Clean`.
- Returns `ResolvedLink{ Path string; Exists bool; IsMarkdown bool }`
  (`IsMarkdown` via the existing `isMarkdownFile`).
- Shared by preview (gate + path for `previewFileHead`) and open (path for
  `files.openPath`). No new filesystem surface — reads still go through the
  existing bounded `PreviewFile` / `ReadFile`.

## Frontend pieces

1. **`services/workspace.ts`** — `resolveLink(fromFile, href)` wrapping the Go
   method.
2. **`ui/filePreviewPopover.ts`** (refactor) — lift the popover + dwell timer +
   stale-token guard + on-screen positioning + `extractPreview`/`cleanInline`
   out of `ui/explorer/hoverPreview.ts` into a shared module that anchors to a
   `DOMRect` rather than being path-keyed. `explorer/hoverPreview.ts` becomes a
   thin adapter (resolve-anchor-by-path); the link preview supplies the hovered
   element's rect.
3. **`editor/extensions/LinkPreview.ts`** (new) — a ProseMirror plugin with
   `mouseover`/`mousemove`/`mouseout` handlers. Over a candidate local-`.md`
   link, `schedule(rect, fromFile, href)`; the scheduled fire calls
   `resolveLink` → if `exists && isMarkdown`, `previewFileHead(path)` → popover.
   Cancel on mouse-out / scroll / selection change / blur. One popover per
   editor, disposed with the tab.
4. **`editor/extensions/LinkOpen.ts`** (extend) — when the ⌘/Ctrl-clicked href is
   *not* absolute, run the same pre-filter, `resolveLink`, and if markdown
   `commands.execute('files.openPath', { path })` + `preventDefault`. Absolute
   links unchanged.
5. **Wiring** — attach `LinkPreview` alongside `LinkOpen` / `canvasClick` in the
   per-tab editor setup; register the popover in the tab's disposables.
6. **CSS** — reuse the existing preview popover styles (shared class).

## Edge cases / non-goals (v1)

- Untitled source doc: relative links have no base → no preview/open (`file://`
  still works).
- Missing target / non-`.md`: **silent no-op** (no error popover). *[decided]*
- `#anchor` within the target: opens/previews the whole file; we don't scroll to
  the heading (future).
- Images / non-`.md` files: not previewed (preview is a markdown head only).
- Windows cross-drive handled via `file://`; UNC `\\server\share` left as-is
  (matches `fileURL` v1 scope).
- Reads are bounded (`PreviewFile` ~8KB), so large targets stay cheap.

## Decisions (locked)

- Trigger: **dwell-only ~700ms**, no modifier.
- ⌘/Ctrl-click **opens local `.md` in-app** via `files.openPath` (switch if
  already open, else new tab).
- Missing / non-md targets: **silent**.

## Files

- `app/workspaceservice.go` (+`ResolveLink`, +`ResolvedLink`) → regenerate bindings
- `frontend/src/services/workspace.ts` (+`resolveLink`)
- `frontend/src/ui/filePreviewPopover.ts` (new, shared)
- `frontend/src/ui/explorer/hoverPreview.ts` (use shared popover)
- `frontend/src/editor/extensions/LinkPreview.ts` (new)
- `frontend/src/editor/extensions/LinkOpen.ts` (local open)
- editor wiring + CSS
