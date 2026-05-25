import type { Workspace } from './workspace'
import { SetWindowTitle } from './ipc'

export function mountTitle(ws: Workspace): void {
  const refresh = (): void => {
    const title = (ws.modified ? '• ' : '') + ws.fileName() + ' — MarkdownMD'
    document.title = title
    void SetWindowTitle(title).catch(() => {})
  }
  ws.onChange(refresh)
  refresh()
}
