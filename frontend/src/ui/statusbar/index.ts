import type { Editor } from '@tiptap/core'
import type { Workspace } from '../../app/workspace'
import './statusbar.css'

interface CharacterCountStorage {
  characters(): number
  words(): number
}

export function mountStatusbar(ws: Workspace): { refresh: () => void } {
  const editor: Editor = ws.editor
  const wordsEl = document.getElementById('st-words')
  const charsEl = document.getElementById('st-chars')
  const linesEl = document.getElementById('st-lines')
  const fileEl = document.getElementById('st-file')

  const refresh = (): void => {
    const cc = editor.storage.characterCount as CharacterCountStorage
    if (wordsEl) wordsEl.textContent = `${cc.words()} words`
    if (charsEl) charsEl.textContent = `${cc.characters()} characters`
    const lines = Math.max(1, editor.getText().split('\n').filter(Boolean).length)
    if (linesEl) linesEl.textContent = `${lines} lines`
    if (fileEl) fileEl.textContent = ws.fileName()
  }

  ws.onChange(refresh)
  return { refresh }
}
