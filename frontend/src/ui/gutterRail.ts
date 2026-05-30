import type { TabManager } from '../app/tabManager'
import type { ExplorerState } from '../app/explorerState'

// A small owner of the left-of-content vertical icon stack ("gutter rail"). It
// factors out the positioning the ToC button used to do on its own — measure the
// active editor's content column and park buttons just outside its left edge —
// and adds vertical slot assignment so multiple items (ToC, Change History, …)
// stack and reflow as their individual visibility changes.
//
// Items own their own button element and (optionally) a floating panel; the rail
// only positions the buttons and reports each visible item's `top` via onLayout
// so the item can align its panel. The whole rail hides while the file-explorer
// overlay is open (it slides over this same corner) — centralized here so every
// rail item inherits it instead of re-checking.

// Keep in sync with the button footprint in toc.css / changeHistory.css.
const BUTTON_SIZE = 32
const BUTTON_GAP = 10 // gap from the content's left edge
const STACK_GAP = 8 // vertical gap between stacked rail buttons
const RAIL_TOP = 12 // top offset of the first slot

export interface RailItemSpec {
  /** Stable id for logging/dedupe. */
  id: string
  /** Lower sorts higher in the stack (ToC = 10, Change History = 20, …). */
  order: number
  /** The item's button element (the rail positions + shows/hides it). */
  button: HTMLElement
}

export interface RailItemHandle {
  /** Show or hide this item; triggers a rail reflow. */
  setVisible(v: boolean): void
  /** Fires with this item's assigned top (px) whenever its slot moves. */
  onLayout(fn: (top: number) => void): () => void
  /** Remove the item from the rail (and the DOM). */
  dispose(): void
}

export interface GutterRail {
  register(spec: RailItemSpec): RailItemHandle
  /** Recompute positions (left edge + slots). Safe to call often. */
  reposition(): void
}

interface Item extends RailItemSpec {
  visible: boolean
  top: number
  layoutListeners: Set<(top: number) => void>
}

export function mountGutterRail(
  host: HTMLElement,
  tm: TabManager,
  explorer: ExplorerState,
): GutterRail {
  const items: Item[] = []
  let left = 8

  function computeLeft(): number {
    const tab = tm.active()
    const content = tab?.dom.editorElement.querySelector<HTMLElement>('.ProseMirror')
    if (!content) return left
    const contentLeft = content.getBoundingClientRect().left - host.getBoundingClientRect().left
    return Math.max(8, Math.round(contentLeft - BUTTON_GAP - BUTTON_SIZE))
  }

  function layout(): void {
    left = computeLeft()
    const hideAll = explorer.overlayOpen
    const ordered = [...items].sort((a, b) => a.order - b.order)
    let slot = 0
    for (const it of ordered) {
      it.button.style.left = `${left}px`
      if (!it.visible || hideAll) {
        it.button.style.display = 'none'
        continue
      }
      const top = RAIL_TOP + slot * (BUTTON_SIZE + STACK_GAP)
      it.button.style.top = `${top}px`
      it.button.style.display = 'flex'
      slot++
      if (it.top !== top) {
        it.top = top
        for (const fn of it.layoutListeners) fn(top)
      } else {
        // left may have changed even when the slot index didn't — let panels realign.
        for (const fn of it.layoutListeners) fn(top)
      }
    }
  }

  function register(spec: RailItemSpec): RailItemHandle {
    const item: Item = {
      ...spec,
      visible: false,
      top: RAIL_TOP,
      layoutListeners: new Set(),
    }
    spec.button.style.position = 'absolute'
    spec.button.style.display = 'none'
    host.appendChild(spec.button)
    items.push(item)
    layout()
    return {
      setVisible(v: boolean): void {
        if (item.visible === v) return
        item.visible = v
        layout()
      },
      onLayout(fn: (top: number) => void): () => void {
        item.layoutListeners.add(fn)
        return () => item.layoutListeners.delete(fn)
      },
      dispose(): void {
        const i = items.indexOf(item)
        if (i >= 0) items.splice(i, 1)
        item.button.remove()
        item.layoutListeners.clear()
        layout()
      },
    }
  }

  // Reflow on the same triggers ToC used to watch: tab switch / content changes
  // (tm), explorer overlay open/close, and window resize (content column moves).
  tm.onChange(layout)
  explorer.onChange(layout)
  let resizeRaf = false
  window.addEventListener('resize', () => {
    if (resizeRaf) return
    resizeRaf = true
    requestAnimationFrame(() => {
      resizeRaf = false
      layout()
    })
  })

  return { register, reposition: layout }
}

/** The shared left position helper for rail items that float a panel beside their
 * button. Returns the current left (px) the rail is using. */
export function railButtonLeft(button: HTMLElement): number {
  return parseInt(button.style.left || '8', 10) || 8
}
