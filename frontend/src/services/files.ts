import type { Workspace } from '../app/workspace'
import { OpenFileDialog, ReadFile, SaveFileDialog, WriteFile } from '../app/ipc'
import { getMarkdown, setMarkdown } from '../editor/serialize/markdown'
import { confirmDialog } from '../ui/confirmDialog'

async function confirmDiscard(ws: Workspace): Promise<boolean> {
  if (!ws.modified) return true
  return confirmDialog({
    title: 'Unsaved changes',
    message: 'Discard your unsaved changes?',
    confirmLabel: 'Discard',
    cancelLabel: 'Cancel',
  })
}

export async function newFile(ws: Workspace): Promise<void> {
  if (!(await confirmDiscard(ws))) return
  setMarkdown(ws.editor, '')
  ws.setFilePath(null)
  ws.setModified(false)
}

export async function openFile(ws: Workspace): Promise<void> {
  if (!(await confirmDiscard(ws))) return
  try {
    const path = await OpenFileDialog()
    if (!path) return
    const text = await ReadFile(path)
    setMarkdown(ws.editor, text)
    ws.setFilePath(path)
    ws.setModified(false)
  } catch (err) {
    alert('Could not open file: ' + String(err))
  }
}

export async function saveFile(ws: Workspace): Promise<void> {
  if (!ws.filePath) return saveFileAs(ws)
  try {
    await WriteFile(ws.filePath, getMarkdown(ws.editor))
    ws.setModified(false)
  } catch (err) {
    alert('Could not save: ' + String(err))
  }
}

export async function saveFileAs(ws: Workspace): Promise<void> {
  try {
    const path = await SaveFileDialog(ws.filePath || 'Untitled.md')
    if (!path) return
    ws.setFilePath(path)
    await WriteFile(path, getMarkdown(ws.editor))
    ws.setModified(false)
  } catch (err) {
    alert('Could not save: ' + String(err))
  }
}

export function insertLink(ws: Workspace): void {
  if (ws.linkController?.requestLink()) return
  const prev = (ws.editor.getAttributes('link').href as string | undefined) || ''
  const url = prompt('URL:', prev)
  if (url === null) return
  if (url === '') {
    ws.editor.chain().focus().unsetLink().run()
  } else {
    ws.editor.chain().focus().setLink({ href: url }).run()
  }
}

export function insertImage(ws: Workspace): void {
  const url = prompt('Image URL:')
  if (!url) return
  ws.editor.chain().focus().setImage({ src: url }).run()
}
