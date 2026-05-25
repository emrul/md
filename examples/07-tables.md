# Tables

GFM pipe-tables. Resizable columns and a floating toolbar appear when your cursor is inside a table.

## A small reference

| Shortcut    | Action                  |
| ----------- | ----------------------- |
| `⌘B`        | Bold                    |
| `⌘I`        | Italic                  |
| `⌘E`        | Inline code             |
| `⌘K`        | Insert / edit link      |
| `⌘]` / `⌘[` | Cycle heading level     |
| `⌘⇧7`       | Ordered list            |
| `⌘⇧8`       | Bullet list             |
| `⌘⇧9`       | Task list               |
| `⌘⇧K`       | Code block              |
| `Tab`       | Indent inside code/list |

## Inline marks in cells

| Plain | Bold       | Italic     | Code           | Link                        |
| ----- | ---------- | ---------- | -------------- | --------------------------- |
| one   | **bold**   | _italic_   | `inline`       | [tiptap](https://tiptap.dev) |
| two   | **strong** | _stress_   | `array.map`    | [pm](https://prosemirror.net) |
| three | ~~strike~~ | _emphasis_ | `path/to/file` | [docs](https://example.com) |

## Alignment

Use leading/trailing colons in the separator row for column alignment. Most renderers honour these; tiptap-markdown preserves them on round-trip.

| Left    | Centred   | Right   |
| :------ | :-------: | ------: |
| 1       | apple     |   1.00  |
| 22      | banana    |  22.00  |
| 333     | cherry    | 333.00  |

## What to try

- Click inside any cell — the floating toolbar appears above the table.
- Use the toolbar to add/remove rows and columns, toggle the header row, or delete the whole table.
- Drag the right edge of a column header to resize.
- Type `/table` on an empty line to insert a fresh 3×3 table with a header row.
- Tab moves to the next cell; Shift+Tab moves to the previous one.
- Save with `⌘S`, reopen — pipe-table syntax (including alignment colons) survives round-trip.
