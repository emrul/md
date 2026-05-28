import type { TabManager } from '../../app/tabManager'
import type { ExplorerState } from '../../app/explorerState'
import { homeDir } from '../../services/workspace'
import './statusbar.css'

const GIT_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v10"/><path d="M11 9V7a2 2 0 0 0-2-2H7"/><circle cx="5" cy="3" r="1.4"/><circle cx="11" cy="13" r="1.4"/><circle cx="5" cy="13" r="1.4"/></svg>`

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

// Cheap dependency-free token estimate (~4 chars/token). Good to within
// ~10-20% for English prose; labelled "~" since it isn't a real tokenizer.
function estimateTokens(text: string): number {
  return Math.round(text.length / 4)
}

function toSlash(p: string): string {
  return p.replace(/\\/g, '/')
}

function basename(p: string): string {
  const parts = toSlash(p).split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * Footer path display:
 *   - Inside the pinned root → "<rootName>/<relative>" (root folder name
 *     gives context; the rest is the path within it).
 *   - Else inside home → "~/<relative>".
 *   - Else → absolute path.
 */
function displayPath(filePath: string, root: string, home: string): string {
  if (!filePath) return ''
  const fp = toSlash(filePath)
  if (root) {
    const r = toSlash(root)
    if (fp === r || fp.startsWith(r + '/')) {
      const rel = fp.slice(r.length).replace(/^\/+/, '')
      return rel ? `${basename(r)}/${rel}` : basename(r)
    }
  }
  if (home) {
    const h = toSlash(home)
    if (fp === h || fp.startsWith(h + '/')) {
      return '~' + fp.slice(h.length)
    }
  }
  return fp
}

export function mountStatusbar(
  tm: TabManager,
  explorer: ExplorerState,
): { refresh: () => void } {
  const wordsEl = document.getElementById('st-words')
  const charsEl = document.getElementById('st-chars')
  const linesEl = document.getElementById('st-lines')
  const tokensEl = document.getElementById('st-tokens')
  const fileEl = document.getElementById('st-file')
  const gitEl = document.getElementById('st-git')

  // Home dir is app-stable; fetch once for the path display fallback.
  let homeCache = ''
  void homeDir()
    .then((h) => {
      homeCache = h
      refresh()
    })
    .catch(() => {})

  const refresh = (): void => {
    const tab = tm.active()
    const md = tab?.getCurrentMarkdown() ?? ''
    if (wordsEl) wordsEl.textContent = `${countWords(md)} words`
    if (charsEl) charsEl.textContent = `${md.length} characters`
    const lines = md ? md.split('\n').length : 1
    if (linesEl) linesEl.textContent = `${lines} lines`
    if (tokensEl) tokensEl.textContent = `~${estimateTokens(md)} tokens`

    // Git branch chip.
    if (gitEl) {
      if (tab?.gitRoot && tab.gitBranch) {
        gitEl.innerHTML = `${GIT_ICON}<span class="st-git-branch">${tab.gitBranch}</span>`
        gitEl.hidden = false
        gitEl.title = `On branch ${tab.gitBranch} · ${tab.gitRoot}`
      } else {
        gitEl.hidden = true
        gitEl.textContent = ''
      }
    }

    // Path / mode.
    if (fileEl) {
      if (!tab) {
        fileEl.textContent = 'Markdown'
        fileEl.removeAttribute('title')
      } else if (!tab.filePath) {
        fileEl.textContent = 'Untitled'
        fileEl.removeAttribute('title')
      } else {
        const mode = tab.viewController?.mode === 'source' ? ' · Source' : ''
        const shown = displayPath(tab.filePath, explorer.pinnedRoot ?? '', homeCache)
        fileEl.textContent = shown + mode
        fileEl.title = tab.filePath
      }
    }
  }

  tm.onChange(refresh)
  // Pinned-root changes affect the displayed path even without a tab change.
  explorer.onChange(refresh)
  return { refresh }
}
