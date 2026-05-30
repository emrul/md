import type { Editor } from '@tiptap/core'
import { setHybridMarkdown } from './hybridLoad'
import { getRenderMode, type RenderMode } from '../mode'

interface MarkdownStorage {
  getMarkdown(): string
}

function storage(editor: Editor): MarkdownStorage {
  return editor.storage.markdown as MarkdownStorage
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
