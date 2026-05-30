import type { Editor } from '@tiptap/core'
import { setHybridMarkdown } from './hybridLoad'
import { getRenderMode, type RenderMode } from '../mode'

interface MarkdownStorage {
  getMarkdown(): string
}

// The markdown-it parser tiptap-markdown stores on the editor; `parse` returns an
// HTML string. The editor configures it with `html: false`, so any raw HTML in the
// source is escaped rather than passed through.
interface MarkdownParserIO {
  parser: { parse(md: string): string }
}

function storage(editor: Editor): MarkdownStorage {
  return editor.storage.markdown as MarkdownStorage
}

/**
 * Render a markdown string to an HTML string using the editor's own markdown-it
 * parser (the same one TipTap loads content through). Because that parser runs
 * with `html: false`, embedded raw HTML is **escaped**, not executed — so callers
 * can safely set the result as `innerHTML` and then decorate it. Exposed via the
 * `@markdownmd` barrel so the commercial overlay (diff view) reuses this single
 * trusted path instead of re-implementing it. Do not enable the parser's `html`
 * option to "fix" anything here.
 */
export function renderMarkdownToHtml(editor: Editor, md: string): string {
  return (editor.storage.markdown as unknown as MarkdownParserIO).parser.parse(md)
}

export function getMarkdown(editor: Editor): string {
  return storage(editor).getMarkdown()
}

export function setMarkdown(editor: Editor, text: string, mode?: RenderMode): void {
  // Route loads by render mode: hybrid turns top-level paragraphs/headings into
  // source blocks; wysiwyg loads as plain TipTap. Defaults to the editor's
  // current mode; pass an explicit mode when the current doc is stale (e.g.
  // rebuilding after the source view).
  const target = mode ?? getRenderMode(editor)
  if (target === 'hybrid') setHybridMarkdown(editor, text)
  else editor.commands.setContent(text)
}
