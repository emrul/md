import type { TabManager } from '../../app/tabManager'
import './statusbar.css'

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function mountStatusbar(tm: TabManager): { refresh: () => void } {
  const wordsEl = document.getElementById('st-words')
  const charsEl = document.getElementById('st-chars')
  const linesEl = document.getElementById('st-lines')
  const fileEl = document.getElementById('st-file')

  const refresh = (): void => {
    const tab = tm.active()
    const md = tab?.getCurrentMarkdown() ?? ''
    if (wordsEl) wordsEl.textContent = `${countWords(md)} words`
    if (charsEl) charsEl.textContent = `${md.length} characters`
    const lines = md ? md.split('\n').length : 1
    if (linesEl) linesEl.textContent = `${lines} lines`
    if (fileEl) {
      if (!tab) {
        fileEl.textContent = 'Markdown'
      } else {
        const mode = tab.viewController?.mode === 'source' ? ' · Source' : ''
        fileEl.textContent = tab.fileName() + mode
      }
    }
  }

  tm.onChange(refresh)
  return { refresh }
}
