import type { Editor } from '@tiptap/core'

interface MarkdownStorage {
  getMarkdown(): string
}

function storage(editor: Editor): MarkdownStorage {
  return editor.storage.markdown as MarkdownStorage
}

export function getMarkdown(editor: Editor): string {
  return storage(editor).getMarkdown()
}

export function setMarkdown(editor: Editor, text: string): void {
  editor.commands.setContent(text)
}
