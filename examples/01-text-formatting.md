# Text formatting

Inline marks render as styled text. Place the cursor on any paragraph below to reveal the markdown markers around the formatting.

## Basic emphasis

You can write **bold** text with double asterisks, _italic_ text with underscores, and ~~strikethrough~~ text with double tildes. They compose: **_bold italic_**, _**italic bold**_, and ~~**bold strike**~~.

## Inline code

Use single backticks for `inline code` — handy for `variableNames`, `path/to/file.ts`, or short snippets like `Array.from(set).sort()`.

## Links

Plain link: [Anthropic](https://www.anthropic.com).

With trailing text: see the [TipTap docs](https://tiptap.dev/docs) for extension reference, or jump to the [ProseMirror guide](https://prosemirror.net/docs/guide/) for the underlying model.

Auto-links by URL are not yet enabled — wrap explicit URLs in `[label](url)`.

## Combinations

A paragraph can mix all of the above: **bold next to _italic with `inline code`_**, followed by a [link with **bold text** inside](https://example.com), then ~~strikethrough including `code`~~.

## Hard line breaks

End a line with two trailing spaces  
to force a soft line break inside the same paragraph.

## What to try

- Click into a paragraph — the `**`, `_`, `~~` and link markers reveal on that line and disappear when the cursor leaves.
- Select any run of text and use the bubble menu (or `⌘B` / `⌘I` / `⌘E` / `⌘K`) to apply marks.
- `⌘K` over an existing link opens the inline URL editor in the bubble menu.
