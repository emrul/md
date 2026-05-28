import type { ExplorerState } from '../../app/explorerState'
import { commands } from '../../commands'
import { prefs } from '../../app/preferences'
import {
  readDir,
  statMtimes,
  createFileNear,
  createFolderNear,
  compareEntries,
  type DirEntry,
  type ReadDirResult,
} from '../../services/workspace'
import { RenameFile } from '../../app/ipc'
import { openPath } from '../../services/files'
import type { TabManager } from '../../app/tabManager'
import { log } from '../../services/log'

const ICON_CHEVRON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>`
const ICON_FOLDER = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5a1.5 1.5 0 0 1 1.5-1.5h2.5l1.5 1.5h5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.5-1.5z"/></svg>`
const ICON_FILE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.5h5l3 3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><path d="M9 2.5v3h3"/></svg>`
const ICON_BRANCH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v10"/><path d="M11 9V7a2 2 0 0 0-2-2H7"/><circle cx="5" cy="3" r="1.4"/><circle cx="11" cy="13" r="1.4"/><circle cx="5" cy="13" r="1.4"/></svg>`
const ICON_PIN = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3-2 2-1 4-2-2-3.5 3.5L4 12l3.5-3.5-2-2 4-1z"/></svg>`

interface VisibleRow {
  entry: DirEntry
  depth: number
  parentPath: string | null
}

export interface TreeMount {
  setRoot: (path: string) => Promise<void>
  refresh: () => Promise<void>
  /** Move keyboard focus into the tree (for ⌘⇧E open-and-focus flows). */
  focus: () => void
  /**
   * Current root snapshot. `path` is empty before any root has been set;
   * `gitRoot` is the enclosing repo root from the latest ReadDirResult,
   * empty when the root isn't inside a repo.
   */
  getRoot: () => { path: string; gitRoot: string }
  /** Start an inline rename for path (replaces the row's name with an input). */
  beginRename: (path: string) => void
  /** Start an inline create for a new file. refPath is the right-clicked row;
   *  if it's a folder we create inside it; otherwise inside its parent. */
  beginNewFile: (refPath: string) => void
  /** Same as beginNewFile but for a directory. */
  beginNewFolder: (refPath: string) => void
  /**
   * Return all markdown file paths directly inside folderPath (non-recursive).
   * Ensures a listing is loaded/valid first. Used by double-click-open-all.
   */
  collectMarkdownChildren: (folderPath: string) => Promise<string[]>
  dispose: () => void
}

/**
 * Tree renders a single-level-at-a-time markdown file tree with keyboard nav.
 *
 * State ownership:
 *   - `expandedPaths` + `selectedPath` live in ExplorerState (per-window).
 *   - Listings (the per-folder ReadDirResult cache) live here in memory.
 *     The mtime-based validity cache is step 8.
 *
 * Step 4 scope: persistent selection (aria-selected + bg), focus ring on the
 * selected row's icon when the tree wrapper has keyboard focus, arrow-key
 * walking of visible rows, Enter opens a file via commands.files.openPath.
 */
interface CachedListing {
  parentMtime: number
  subfolderMtimes: Map<string, number> // subPath → mtime, populated from result.entries
  result: ReadDirResult
}

export function mountTree(container: HTMLElement, state: ExplorerState, tm: TabManager): TreeMount {
  // Listings cache: each entry tracks parent + per-subfolder mtimes so the
  // validity check on re-expand can detect external changes in one
  // StatMtimes round-trip. See plan: "Empty-folder filtering and git
  // detection (piggyback)" and "Caching".
  const listings = new Map<string, CachedListing>()
  let rootPath = ''
  let renderToken = 0
  let visibleRows: VisibleRow[] = []

  // Inline edit state — for Rename and New File/Folder. WKWebView eats
  // window.prompt silently, so we render an <input> in the tree instead
  // (same pattern as the tab strip's rename).
  type EditKind = 'rename' | 'new-file' | 'new-folder'
  interface PendingEdit {
    kind: EditKind
    refPath: string // rename: the row's own path. new-*: the right-clicked row.
    value: string
  }
  let pendingEdit: PendingEdit | null = null
  let focusEditAfterRender = false
  // Tracks the deferred single-click toggle on folders so a fast second
  // click (which fires dblclick) can preempt and switch to open-all-markdown.
  let dirToggleTimer: ReturnType<typeof setTimeout> | null = null
  // Set of row paths visible at the previous render. Used to give rows that
  // weren't there before a fade-in animation — the "buttery" expand feel
  // without needing nested DOM groups or DOM diffing.
  let previousVisiblePaths = new Set<string>()

  // The wrapper is what receives keyboard focus. The container we were given
  // is the scroll viewport; we render rows into a focusable child so arrow
  // keys keep the tree focused while scrolling.
  const wrapper = document.createElement('div')
  wrapper.className = 'tree-wrapper'
  wrapper.setAttribute('tabindex', '0')
  wrapper.setAttribute('role', 'tree')
  wrapper.setAttribute('aria-label', 'Files')
  container.appendChild(wrapper)

  /**
   * Unconditional fetch from disk. Stores in cache with computed mtime
   * tracking. Used when the cache is known stale (refresh, setRoot, after a
   * StatMtimes mismatch).
   */
  async function fetchAndStore(path: string): Promise<ReadDirResult | null> {
    try {
      const result = await readDir(path, { showDotFolders: prefs().showDotFolders })
      const subfolderMtimes = new Map<string, number>()
      for (const e of result.entries) {
        if (e.isDir && typeof e.mtime === 'number' && e.mtime > 0) {
          subfolderMtimes.set(e.path, e.mtime)
        }
      }
      listings.set(path, {
        parentMtime: result.parentMtime ?? 0,
        subfolderMtimes,
        result,
      })
      return result
    } catch (err) {
      log.warn('explorer', `read ${path}: ${(err as Error).message ?? String(err)}`)
      return null
    }
  }

  /**
   * Cached-or-fresh fetch. Validates the cached entry against current
   * on-disk mtimes via a single StatMtimes round-trip; if anything has
   * changed (or there's no cache), refetches.
   *
   * The validity check covers the empty-folder-filter staleness window
   * documented in the plan — a subfolder's contents can change without
   * the parent's own mtime moving, so we have to stat each cached subfolder
   * too.
   */
  async function ensureListing(path: string): Promise<ReadDirResult | null> {
    const cached = listings.get(path)
    if (!cached) return fetchAndStore(path)

    const subPaths = Array.from(cached.subfolderMtimes.keys())
    const allPaths = [path, ...subPaths]
    let mtimes: number[]
    try {
      mtimes = await statMtimes(allPaths)
    } catch {
      // If we can't validate, trust the cache for this call.
      return cached.result
    }
    if (mtimes[0] !== cached.parentMtime) return fetchAndStore(path)
    for (let i = 0; i < subPaths.length; i++) {
      const expected = cached.subfolderMtimes.get(subPaths[i])
      if (mtimes[i + 1] !== expected) return fetchAndStore(path)
    }
    return cached.result
  }

  function renderRow(row: VisibleRow): HTMLElement {
    const { entry, depth } = row
    const el = document.createElement('div')
    el.className = 'tree-row'
    el.dataset.path = entry.path
    el.dataset.isDir = String(entry.isDir)
    el.setAttribute('role', entry.isDir ? 'treeitem' : 'treeitem')
    el.setAttribute('aria-level', String(depth + 1))
    el.style.paddingLeft = `${depth * 16 + 8}px`
    // Drives the indent-guide vertical line in CSS — see .tree-row::before
    // in styles.css. Depth 0 hides the line.
    el.style.setProperty('--depth', String(depth))

    // Native context menu wiring. Wails reads --custom-contextmenu (menu
    // name) and --custom-contextmenu-data (payload) on right-click. The
    // four explorer menus are registered in menu.go; we pick the variant
    // based on isDir + whether the entry inherits a non-empty gitRoot.
    const inGit = entry.gitRoot !== '' && entry.gitRoot != null
    const menuName = entry.isDir
      ? inGit
        ? 'explorer-folder-git'
        : 'explorer-folder'
      : inGit
        ? 'explorer-file-git'
        : 'explorer-file'
    el.style.setProperty('--custom-contextmenu', menuName)
    el.style.setProperty('--custom-contextmenu-data', entry.path)

    const isSelected = state.selectedPath === entry.path
    if (isSelected) {
      el.classList.add('is-selected')
      el.setAttribute('aria-selected', 'true')
    }
    if (entry.isDir) {
      el.setAttribute('aria-expanded', String(state.expandedPaths.has(entry.path)))
    }

    const chevronSlot = document.createElement('span')
    chevronSlot.className = 'tree-chevron'
    if (entry.isDir) {
      chevronSlot.innerHTML = ICON_CHEVRON
      chevronSlot.classList.toggle('is-expanded', state.expandedPaths.has(entry.path))
    } else {
      chevronSlot.classList.add('is-empty')
    }
    el.appendChild(chevronSlot)

    const iconSlot = document.createElement('span')
    iconSlot.className = 'tree-icon'
    iconSlot.innerHTML = entry.isDir ? ICON_FOLDER : ICON_FILE
    el.appendChild(iconSlot)

    if (pendingEdit && pendingEdit.kind === 'rename' && pendingEdit.refPath === entry.path) {
      // This row is being renamed — render an inline input instead of the
      // static name. Pre-fill with current name (selectAt-time selects the
      // basename portion).
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'tree-row-edit-input'
      input.value = pendingEdit.value
      input.spellcheck = false
      input.autocomplete = 'off'
      input.addEventListener('input', () => {
        if (pendingEdit) pendingEdit.value = input.value
      })
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void commitEdit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelEdit()
        }
        e.stopPropagation()
      })
      input.addEventListener('blur', () => {
        if (pendingEdit) cancelEdit()
      })
      input.addEventListener('click', (e) => e.stopPropagation())
      el.appendChild(input)
    } else {
      const nameEl = document.createElement('span')
      nameEl.className = 'tree-name'
      nameEl.textContent = entry.name
      el.appendChild(nameEl)
    }

    if (entry.isDir && entry.gitRoot && entry.gitRoot === entry.path) {
      const branch = document.createElement('span')
      branch.className = 'tree-git-decoration'
      branch.innerHTML = ICON_BRANCH
      branch.title = 'Git repository'
      el.appendChild(branch)
    }

    // Pin icon on folder rows. CSS makes it hover-revealed by default and
    // always-visible on the pinned-root row. Click toggles the pin and
    // stopPropagation prevents the row's expand/select behavior from firing.
    if (entry.isDir) {
      const pin = document.createElement('button')
      pin.type = 'button'
      pin.className = 'tree-pin'
      const isPinned = state.pinnedRoot === entry.path
      pin.classList.toggle('is-active', isPinned)
      pin.title = isPinned ? 'Unpin' : 'Pin as root'
      pin.setAttribute('aria-label', pin.title)
      pin.setAttribute('aria-pressed', String(isPinned))
      pin.innerHTML = ICON_PIN
      pin.addEventListener('click', (ev) => {
        ev.stopPropagation()
        if (isPinned) {
          state.setPinnedRoot(null)
        } else {
          // Route through setPinIntent so pinning the current contextual root
          // (the rare but possible case) just clears instead of setting a
          // no-op pin.
          state.setPinIntent(entry.path)
        }
      })
      el.appendChild(pin)
    }

    el.addEventListener('click', () => {
      state.setSelected(entry.path)
      wrapper.focus({ preventScroll: true })
      if (!entry.isDir) {
        commands.execute('files.openPath', { path: entry.path })
        state.setOverlayOpen(false)
        return
      }
      // Folder: defer the toggle ~250ms so a follow-up second click can
      // upgrade the gesture to a double-click → open-all-markdown.
      if (dirToggleTimer) clearTimeout(dirToggleTimer)
      const target = entry.path
      dirToggleTimer = setTimeout(() => {
        dirToggleTimer = null
        void toggleFolder(target)
      }, 250)
    })

    if (entry.isDir) {
      el.addEventListener('dblclick', () => {
        if (dirToggleTimer) {
          clearTimeout(dirToggleTimer)
          dirToggleTimer = null
        }
        commands.execute('explorer.openAllMarkdown', { path: entry.path })
        state.setOverlayOpen(false)
      })
      // Drag source for folders — drop into the editor inserts a bullet
      // list of links to its direct markdown children. Distinct MIME from
      // file drags so the drop handler can pick the right behavior without
      // an extra stat round-trip.
      el.setAttribute('draggable', 'true')
      el.addEventListener('dragstart', (ev) => {
        if (!ev.dataTransfer) return
        ev.dataTransfer.setData('application/x-markdownmd-folder-path', entry.path)
        ev.dataTransfer.effectAllowed = 'copy'
      })
    } else if (isMarkdownName(entry.name)) {
      // Drag source for markdown files. Non-md files are filtered out of
      // listings already so this branch wouldn't hit for them anyway.
      el.setAttribute('draggable', 'true')
      el.addEventListener('dragstart', (ev) => {
        if (!ev.dataTransfer) return
        ev.dataTransfer.setData('application/x-markdownmd-path', entry.path)
        ev.dataTransfer.effectAllowed = 'copy'
      })
    }

    return el
  }

  async function toggleFolder(path: string): Promise<void> {
    if (state.expandedPaths.has(path)) {
      state.collapse(path)
      return
    }
    await ensureListing(path)
    state.expand(path)
  }

  function collectVisibleRows(): VisibleRow[] {
    const out: VisibleRow[] = []
    if (!rootPath) return out
    const rootCached = listings.get(rootPath)
    if (!rootCached) return out
    walk(rootCached.result.entries, 0, rootPath, out)
    return out
  }

  function walk(
    entries: readonly DirEntry[],
    depth: number,
    parentPath: string,
    out: VisibleRow[],
  ): void {
    for (const entry of entries) {
      out.push({ entry, depth, parentPath })
      if (entry.isDir && state.expandedPaths.has(entry.path)) {
        const child = listings.get(entry.path)
        if (child) walk(child.result.entries, depth + 1, entry.path, out)
      }
    }
  }

  function render(): void {
    visibleRows = collectVisibleRows()
    const frag = document.createDocumentFragment()

    // Compute where the new-file/new-folder placeholder row goes (if any).
    let insertionIndex = -1
    let insertionDepth = 0
    if (pendingEdit && pendingEdit.kind !== 'rename') {
      const target = targetParentDir(pendingEdit.refPath)
      if (target === rootPath) {
        insertionIndex = 0
        insertionDepth = 0
      } else {
        const idx = visibleRows.findIndex((r) => r.entry.path === target)
        if (idx >= 0) {
          insertionIndex = idx + 1
          insertionDepth = visibleRows[idx].depth + 1
        } else {
          insertionIndex = 0
          insertionDepth = 0
        }
      }
    }

    for (let i = 0; i < visibleRows.length; i++) {
      if (i === insertionIndex) frag.appendChild(renderEditRow(insertionDepth))
      const rowEl = renderRow(visibleRows[i])
      // Rows that weren't visible last time fade in. Collapse stays
      // instant (no fade-out) — keeping the asymmetry simple, and the
      // fade-in alone is enough to feel buttery.
      if (!previousVisiblePaths.has(visibleRows[i].entry.path)) {
        rowEl.classList.add('tree-row-entering')
      }
      frag.appendChild(rowEl)
    }
    if (insertionIndex === visibleRows.length) {
      frag.appendChild(renderEditRow(insertionDepth))
    }

    // Empty-state hint when the listing has loaded but contains no visible
    // entries. Skipped if the body is being used for an edit placeholder.
    if (visibleRows.length === 0 && !pendingEdit && rootPath) {
      const empty = document.createElement('div')
      empty.className = 'tree-empty'
      empty.textContent = 'No markdown files'
      frag.appendChild(empty)
    }

    wrapper.replaceChildren(frag)

    // Snapshot the visible-paths set for the next render's fade-in diff.
    previousVisiblePaths = new Set(visibleRows.map((r) => r.entry.path))

    if (focusEditAfterRender && pendingEdit) {
      focusEditAfterRender = false
      const input = wrapper.querySelector<HTMLInputElement>('.tree-row-edit-input')
      if (input) {
        input.focus()
        // For rename, pre-select the name part (minus extension) so typing
        // replaces the basename but keeps the extension. For new-*, the
        // initial value is empty so select() is a no-op.
        const dot = input.value.lastIndexOf('.')
        if (pendingEdit.kind === 'rename' && dot > 0) {
          input.setSelectionRange(0, dot)
        } else {
          input.select()
        }
      }
    }

    scrollSelectedIntoView()
  }

  /**
   * For a refPath that came from a right-click, return the directory in which
   * a new entry should be created: refPath itself when it's a folder, its
   * parent otherwise. Uses the cached visibleRows to look up isDir + parent.
   */
  function targetParentDir(refPath: string): string {
    if (refPath === rootPath) return rootPath
    const r = visibleRows.find((v) => v.entry.path === refPath)
    if (!r) return rootPath
    if (r.entry.isDir) return refPath
    return r.parentPath ?? rootPath
  }

  function renderEditRow(depth: number): HTMLElement {
    const el = document.createElement('div')
    el.className = 'tree-row tree-row-edit'
    el.style.paddingLeft = `${depth * 16 + 8}px`

    // Empty chevron slot to keep the indent alignment.
    const chevronSlot = document.createElement('span')
    chevronSlot.className = 'tree-chevron is-empty'
    el.appendChild(chevronSlot)

    const iconSlot = document.createElement('span')
    iconSlot.className = 'tree-icon'
    iconSlot.innerHTML = pendingEdit?.kind === 'new-folder' ? ICON_FOLDER : ICON_FILE
    el.appendChild(iconSlot)

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'tree-row-edit-input'
    input.value = pendingEdit?.value ?? ''
    input.placeholder = pendingEdit?.kind === 'new-folder' ? 'New folder' : 'New file'
    input.spellcheck = false
    input.autocomplete = 'off'

    input.addEventListener('input', () => {
      if (pendingEdit) pendingEdit.value = input.value
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void commitEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEdit()
      }
    })
    input.addEventListener('blur', () => {
      if (pendingEdit) cancelEdit()
    })
    // Don't bubble to the tree's keyboard nav.
    input.addEventListener('keydown', (e) => e.stopPropagation())
    el.appendChild(input)

    return el
  }

  async function commitEdit(): Promise<void> {
    const edit = pendingEdit
    if (!edit) return
    pendingEdit = null
    const name = edit.value.trim()
    if (!name) {
      render()
      return
    }
    try {
      if (edit.kind === 'rename') {
        const newPath = await RenameFile(edit.refPath, name)
        if (typeof newPath === 'string' && newPath !== edit.refPath) {
          // Two-step path-rewrite that avoids calling refresh():
          //   1. State: remap expandedPaths, selectedPath, pinnedRoot.
          //   2. Listings cache: update the entry in its parent's listing
          //      AND rekey the renamed folder's own listing.
          // We skip refresh because re-fetching applies the empty-folder
          // filter, which would silently drop a just-renamed empty folder
          // — same trap that bit us on create.
          state.rewritePath(edit.refPath, newPath)
          applyRenameToListings(edit.refPath, newPath)
        }
        render()
      } else if (edit.kind === 'new-file') {
        // Default to .md if the user didn't type a markdown extension. Lots of
        // people just type the basename. Without this, the resulting file is
        // extensionless and gets hidden by the non-md file filter on the next
        // refresh.
        const finalName = ensureMarkdownExtension(name)
        const created = await createFileNear(edit.refPath, finalName)
        injectNewEntry(edit.refPath, created, /*isDir*/ false)
        render()
        await openPath(tm, created)
      } else {
        // New folder. We do NOT call refresh() — a freshly-created folder is
        // empty and would be filtered out by the empty-folder rule on the
        // next read. Inject into the parent's cached listing directly so the
        // user sees their new folder immediately. The folder picks up its
        // proper visibility from the normal rule once it has content.
        const created = await createFolderNear(edit.refPath, name)
        injectNewEntry(edit.refPath, created, /*isDir*/ true)
        render()
      }
    } catch (err) {
      log.warn('explorer', `${edit.kind}: ${(err as Error).message ?? String(err)}`)
      render()
    }
  }

  /**
   * After a successful rename, mutate the listings cache in place so the
   * renamed entry stays visible without going through ReadDir again (which
   * would re-apply the empty-folder filter and drop a just-renamed empty
   * folder).
   *
   * Operations:
   *   1. In the parent's listing, replace the old entry with one carrying
   *      the new name + path, then re-sort to keep alphabetical order.
   *   2. If the renamed entry had its own cached listing (e.g. it was
   *      already expanded), rekey it from oldPath to newPath.
   *   3. If any cached listing's key was a descendant of oldPath, rekey it
   *      under newPath too (handles deeply-renamed nested expansions).
   */
  function applyRenameToListings(oldPath: string, newPath: string): void {
    const sep = oldPath.includes('\\') && !oldPath.includes('/') ? '\\' : '/'
    const parentDir = oldPath.slice(0, oldPath.lastIndexOf(sep)) || sep
    const newName = baseNameOf(newPath)

    const parent = listings.get(parentDir)
    if (parent) {
      const updatedEntries = parent.result.entries
        .map((e) => (e.path === oldPath ? { ...e, name: newName, path: newPath } : e))
        .sort(compareEntries)
      const updatedSubMtimes = new Map(parent.subfolderMtimes)
      if (updatedSubMtimes.has(oldPath)) {
        const m = updatedSubMtimes.get(oldPath)!
        updatedSubMtimes.delete(oldPath)
        updatedSubMtimes.set(newPath, m)
      }
      listings.set(parentDir, {
        ...parent,
        subfolderMtimes: updatedSubMtimes,
        result: { ...parent.result, entries: updatedEntries },
      })
    }

    // Rekey any cached listings whose key was the renamed path or a descendant.
    const keys = Array.from(listings.keys())
    for (const key of keys) {
      if (key === oldPath) {
        const own = listings.get(key)!
        listings.delete(key)
        listings.set(newPath, {
          ...own,
          result: { ...own.result, path: newPath },
        })
      } else if (key.startsWith(oldPath + sep)) {
        const rekeyed = newPath + key.slice(oldPath.length)
        const sub = listings.get(key)!
        listings.delete(key)
        listings.set(rekeyed, {
          ...sub,
          result: { ...sub.result, path: rekeyed },
        })
      }
    }
  }

  function ensureMarkdownExtension(name: string): string {
    const lower = name.toLowerCase()
    if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.markdown')) {
      return name
    }
    return name + '.md'
  }

  /**
   * Add a freshly-created entry to its parent's cached listing in sort
   * position. Used immediately after createFileNear / createFolderNear so
   * the user sees the new thing without waiting for a refresh that might
   * filter it back out (empty folder case).
   */
  function injectNewEntry(refPath: string, createdPath: string, isDir: boolean): void {
    const parentDir = targetParentDir(refPath)
    const cached = listings.get(parentDir)
    if (!cached) return
    const mtimeNow = Date.now()
    const newEntry: DirEntry = {
      name: baseNameOf(createdPath),
      path: createdPath,
      isDir,
      // Folders carry mtime for the cache validity check; the OS just stamped
      // it but we don't have the exact value — close enough for cache purposes
      // until the next refresh re-stats.
      mtime: isDir ? mtimeNow : undefined,
      // gitRoot inherits from the parent's repo context.
      gitRoot: cached.result.gitRoot || undefined,
    } as DirEntry
    const newEntries = [...cached.result.entries, newEntry].sort(compareEntries)
    const newSubMtimes = new Map(cached.subfolderMtimes)
    if (isDir) newSubMtimes.set(createdPath, mtimeNow)
    listings.set(parentDir, {
      parentMtime: cached.parentMtime,
      subfolderMtimes: newSubMtimes,
      result: { ...cached.result, entries: newEntries },
    })
  }

  function cancelEdit(): void {
    pendingEdit = null
    render()
  }

  function scrollSelectedIntoView(): void {
    const path = state.selectedPath
    if (!path) return
    const row = wrapper.querySelector<HTMLElement>(`[data-path="${cssEscape(path)}"]`)
    if (!row) return
    const rect = row.getBoundingClientRect()
    const cRect = container.getBoundingClientRect()
    if (rect.top < cRect.top) row.scrollIntoView({ block: 'nearest' })
    else if (rect.bottom > cRect.bottom) row.scrollIntoView({ block: 'nearest' })
  }

  function indexOfSelected(): number {
    if (!state.selectedPath) return -1
    return visibleRows.findIndex((r) => r.entry.path === state.selectedPath)
  }

  function selectAt(i: number): void {
    if (i < 0 || i >= visibleRows.length) return
    state.setSelected(visibleRows[i].entry.path)
  }

  async function onKey(e: KeyboardEvent): Promise<void> {
    if (e.metaKey || e.ctrlKey || e.altKey) return // leave shortcuts alone
    const idx = indexOfSelected()
    const current = idx >= 0 ? visibleRows[idx] : null

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        selectAt(idx < 0 ? 0 : Math.min(idx + 1, visibleRows.length - 1))
        return
      }
      case 'ArrowUp': {
        e.preventDefault()
        selectAt(idx < 0 ? 0 : Math.max(idx - 1, 0))
        return
      }
      case 'ArrowRight': {
        if (!current) return
        e.preventDefault()
        if (current.entry.isDir) {
          if (!state.expandedPaths.has(current.entry.path)) {
            await ensureListing(current.entry.path)
            state.expand(current.entry.path)
          } else {
            selectAt(idx + 1) // descend into first child
          }
        } else {
          selectAt(idx + 1)
        }
        return
      }
      case 'ArrowLeft': {
        if (!current) return
        e.preventDefault()
        if (current.entry.isDir && state.expandedPaths.has(current.entry.path)) {
          state.collapse(current.entry.path)
        } else if (current.parentPath && current.parentPath !== rootPath) {
          state.setSelected(current.parentPath)
        }
        return
      }
      case 'Enter': {
        if (!current) return
        e.preventDefault()
        if (current.entry.isDir) {
          void toggleFolder(current.entry.path)
        } else {
          commands.execute('files.openPath', { path: current.entry.path })
          state.setOverlayOpen(false)
        }
        return
      }
    }
  }

  const keyHandler = (e: KeyboardEvent): void => {
    void onKey(e)
  }
  wrapper.addEventListener('keydown', keyHandler)

  async function setRoot(path: string): Promise<void> {
    // Idempotent on same root: preserves expansion + selection across
    // overlay close/reopen cycles when the contextual root hasn't changed.
    if (path === rootPath && listings.has(path)) {
      // Same root, cache still warm — but validate it. External changes
      // since the last open should surface; cache hits return instantly.
      await ensureListing(path)
      render()
      return
    }
    const token = ++renderToken
    rootPath = path
    listings.clear()
    state.setSelected(null)
    await fetchAndStore(path)
    if (token !== renderToken) return
    render()
  }

  async function refresh(): Promise<void> {
    if (!rootPath) return
    const token = ++renderToken
    listings.clear()
    await fetchAndStore(rootPath)
    for (const path of state.expandedPaths) {
      await fetchAndStore(path)
      if (token !== renderToken) return
    }
    if (token !== renderToken) return
    render()
  }

  const unsubscribe = state.onChange(() => {
    void ensureExpandedFetched().then(render)
  })

  async function ensureExpandedFetched(): Promise<void> {
    for (const path of state.expandedPaths) {
      // ensureListing validates cache via StatMtimes; refetches on mismatch.
      // For paths not in cache it's just a fetch.
      await ensureListing(path)
    }
  }

  function focus(): void {
    wrapper.focus({ preventScroll: true })
  }

  function baseNameOf(path: string): string {
    const parts = path.split(/[/\\]+/).filter(Boolean)
    return parts[parts.length - 1] ?? path
  }

  async function beginRename(path: string): Promise<void> {
    if (path === rootPath || path === '') return
    pendingEdit = { kind: 'rename', refPath: path, value: baseNameOf(path) }
    focusEditAfterRender = true
    render()
  }

  async function beginNewFile(refPath: string): Promise<void> {
    await ensureParentExpanded(refPath)
    pendingEdit = { kind: 'new-file', refPath, value: '' }
    focusEditAfterRender = true
    render()
  }

  async function beginNewFolder(refPath: string): Promise<void> {
    await ensureParentExpanded(refPath)
    pendingEdit = { kind: 'new-folder', refPath, value: '' }
    focusEditAfterRender = true
    render()
  }

  async function collectMarkdownChildren(folderPath: string): Promise<string[]> {
    const result = await ensureListing(folderPath)
    if (!result) return []
    // The render filter already excludes non-markdown files Go-side, so a
    // simple !isDir filter suffices. The extension check is defensive.
    return result.entries
      .filter((e) => !e.isDir && isMarkdownName(e.name))
      .map((e) => e.path)
  }

  function isMarkdownName(name: string): boolean {
    const lower = name.toLowerCase()
    return lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.markdown')
  }

  async function ensureParentExpanded(refPath: string): Promise<void> {
    // If refPath is a collapsed folder, expand it so the placeholder row
    // lands inside (where the new entry will appear after refresh).
    const r = visibleRows.find((v) => v.entry.path === refPath)
    if (r && r.entry.isDir && !state.expandedPaths.has(refPath)) {
      await ensureListing(refPath)
      state.expand(refPath)
    }
  }

  function getRoot(): { path: string; gitRoot: string } {
    const cached = rootPath ? listings.get(rootPath) : undefined
    return { path: rootPath, gitRoot: cached?.result.gitRoot ?? '' }
  }

  return {
    setRoot,
    refresh,
    focus,
    getRoot,
    beginRename,
    beginNewFile,
    beginNewFolder,
    collectMarkdownChildren,
    dispose(): void {
      unsubscribe()
      wrapper.removeEventListener('keydown', keyHandler)
      wrapper.remove()
    },
  }
}

// CSS.escape polyfill — WKWebView has it, but type-safe wrap for older targets.
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s)
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`)
}
