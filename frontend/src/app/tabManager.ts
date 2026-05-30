import { createEditor } from '../editor/createEditor'
import { Tab, type TabDom } from './tab'
import { createViewController } from './viewMode'
import { prefs } from './preferences'

type Listener = () => void

export interface NewTabOptions {
  /** Initial file path (null for "Untitled"). */
  path?: string | null
  /** Initial markdown to load into the editor. Defaults to empty. */
  content?: string
  /**
   * If true, the new tab is created without parsing/rendering `content` into
   * the editor and without becoming active. The pending content is loaded on
   * the first call to `setActive(tab.id)`. Use for multi-file open where only
   * the last tab should be rendered up-front.
   */
  defer?: boolean
}

export interface TabManagerOptions {
  host: HTMLElement
  /** Called when the active tab's content or mode changes (toolbar/statusbar refresh). */
  onAfterTabContentChange: () => void
  /** Called when the active tab's selection changes (toolbar refresh). */
  onAfterSelectionUpdate: () => void
  /** Called once per newly created tab; attach per-tab features here. */
  onTabCreated: (tab: Tab) => void
}

let tabIdSeq = 0
function nextTabId(): string {
  tabIdSeq += 1
  return `tab-${Date.now().toString(36)}-${tabIdSeq}`
}

function buildTabDom(host: HTMLElement, id: string): TabDom {
  const mount = document.createElement('div')
  mount.className = 'tab-mount'
  mount.dataset.tabId = id

  const scroll = document.createElement('div')
  scroll.className = 'editor-scroll'

  const editorElement = document.createElement('div')
  editorElement.className = 'editor-mount'
  scroll.appendChild(editorElement)

  const sourceParent = document.createElement('div')
  sourceParent.className = 'source-view'
  sourceParent.style.display = 'none'

  mount.append(scroll, sourceParent)
  host.appendChild(mount)

  const bubbleMount = document.createElement('div')
  document.body.appendChild(bubbleMount)

  return { mount, editorElement, hybridContainer: scroll, sourceParent, bubbleMount }
}

/**
 * Owns the set of open tabs in this window. Subsystems (toolbar, statusbar,
 * title) subscribe to `onChange` and read from `active()`.
 */
export class TabManager {
  private _tabs: Tab[] = []
  private _activeId: string | null = null
  private listeners: Set<Listener> = new Set()
  private activeTabUnsubscribe: (() => void) | null = null
  private readonly host: HTMLElement
  private readonly onAfterTabContentChange: () => void
  private readonly onAfterSelectionUpdate: () => void
  private readonly onTabCreated: (tab: Tab) => void

  constructor(opts: TabManagerOptions) {
    this.host = opts.host
    this.onAfterTabContentChange = opts.onAfterTabContentChange
    this.onAfterSelectionUpdate = opts.onAfterSelectionUpdate
    this.onTabCreated = opts.onTabCreated
  }

  get tabs(): readonly Tab[] {
    return this._tabs
  }

  get activeId(): string | null {
    return this._activeId
  }

  active(): Tab | null {
    if (!this._activeId) return null
    return this._tabs.find((t) => t.id === this._activeId) ?? null
  }

  newTab(opts: NewTabOptions = {}): Tab {
    const id = nextTabId()
    const dom = buildTabDom(this.host, id)

    // Forward reference: the editor is constructed before the Tab, but
    // the drag-from-tree drop handler needs the tab's filePath at drop
    // time (which is later, after the tab exists). We thread a closure
    // that reads from the Tab once it's assigned.
    let tabRef: Tab | null = null
    const editor = createEditor({
      element: dom.editorElement,
      bubbleMenuElement: dom.bubbleMount,
      onUpdate: () => {
        const t = this.findById(id)
        if (!t) return
        t.setModified(!t.isAtSavedState())
        this.onAfterTabContentChange()
      },
      onSelectionUpdate: () => this.onAfterSelectionUpdate(),
      getSourcePath: () => tabRef?.filePath ?? null,
    })

    const tab = new Tab(id, editor, dom)
    tabRef = tab
    tab.viewController = createViewController({
      editor,
      hybridContainer: dom.hybridContainer,
      sourceParent: dom.sourceParent,
      initialMode: prefs().editorMode,
    })
    tab.viewController.onContentChange(() => {
      tab.setModified(true)
      this.onAfterTabContentChange()
    })
    tab.viewController.onModeChange(() => this.onAfterTabContentChange())

    this._tabs.push(tab)
    this.onTabCreated(tab)

    if (opts.path !== undefined) {
      tab.setFilePath(opts.path)
    }

    if (opts.defer) {
      // Pre-hide so the empty mount doesn't briefly stack alongside the active
      // tab's mount in the flex layout. Content loads on first activation.
      tab.dom.mount.classList.add('is-hidden')
      if (opts.content !== undefined) tab.pendingContent = opts.content
      this.notify()
      return tab
    }

    if (opts.content !== undefined) {
      tab.loadMarkdown(opts.content)
      tab.markLoaded()
    }

    this.setActive(id)
    return tab
  }

  closeTab(id: string): void {
    const idx = this._tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const tab = this._tabs[idx]
    tab.destroy()
    this._tabs.splice(idx, 1)
    if (this._activeId === id) {
      this._activeId = null
      const next = this._tabs[idx] ?? this._tabs[idx - 1] ?? null
      if (next) {
        this.setActive(next.id)
      } else {
        this.activeTabUnsubscribe?.()
        this.activeTabUnsubscribe = null
        this.notify()
      }
    } else {
      this.notify()
    }
  }

  setActive(id: string): void {
    if (this._activeId === id) return
    const next = this._tabs.find((t) => t.id === id)
    if (!next) return

    this.materialize(id)

    for (const t of this._tabs) {
      t.dom.mount.classList.toggle('is-hidden', t.id !== id)
    }
    this.activeTabUnsubscribe?.()
    this._activeId = id
    this.activeTabUnsubscribe = next.onChange(() => this.notify())
    this.notify()

    // Defer focus until the layout reflects the visibility change.
    requestAnimationFrame(() => {
      next.viewController?.focus()
    })
  }

  /**
   * Parse + render the tab's pending markdown into its editor without
   * changing the active tab or visibility. Safe to call multiple times
   * (no-op once materialized) — used for idle-time pre-warm so click-to-
   * switch on a previously-deferred tab feels instant.
   */
  materialize(id: string): void {
    const tab = this._tabs.find((t) => t.id === id)
    if (!tab || tab.pendingContent === null) return
    const content = tab.pendingContent
    tab.pendingContent = null
    tab.loadMarkdown(content)
    tab.markLoaded()
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }

  private findById(id: string): Tab | null {
    return this._tabs.find((t) => t.id === id) ?? null
  }
}
