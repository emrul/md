import { Window } from '@wailsio/runtime'
import type { TabManager } from './tabManager'

// `Window` from @wailsio/runtime is bound to the calling window's ID at
// module-load time and routes SetTitle directly to that window — no
// Window.Current() lookup on the Go side. That avoids a Wails 3 alpha.74
// crash where Current() walks NSApplication.windows while a file dialog is
// open and tries to read `windowId` on the OpenPanel's delegate.
export function mountTitle(tm: TabManager): void {
  const refresh = (): void => {
    const tab = tm.active()
    const title = tab
      ? (tab.modified ? '• ' : '') + tab.fileName() + ' — MarkdownMD'
      : 'MarkdownMD'
    document.title = title
    void Window.SetTitle(title).catch(() => {})
  }
  tm.onChange(refresh)
  refresh()
}
