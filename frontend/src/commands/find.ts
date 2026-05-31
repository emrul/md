import type { TabManager } from '../app/tabManager'
import type { FindState } from '../app/findState'
import { commands } from './registry'

// Only seed the query from the selection when it's plausibly a search term:
// non-empty, single-line, and short. A multi-line or huge selection is almost
// never something you want to find verbatim, and a giant query just yields no
// matches. (Matches the rule pinned in ../../../md-pro/docs/find.md.)
const MAX_SEED_LEN = 100
function seedFromSelection(findState: FindState, tm: TabManager): void {
  if (findState.isOpen) return // don't clobber an in-flight query on re-open
  const find = tm.active()?.viewController?.find
  if (!find) return
  const sel = find.selectedText()
  if (sel && !/[\r\n]/.test(sel) && sel.length <= MAX_SEED_LEN) findState.seed(sel)
}

/**
 * Register the in-document find verbs. Mirrors the ExplorerState split: panel
 * verbs flip FindState; engine verbs delegate lazily through the active tab's
 * ViewController.find at execution time. `Enter`/`Shift+Enter`/`Esc` are handled
 * panel-locally (focus is in an input) and dispatch find.next/find.prev/
 * find.close; the global keymap only fires on Cmd/Ctrl combos.
 */
export function registerFindCommands(findState: FindState, tm: TabManager): void {
  commands.register({
    id: 'find.open',
    label: 'Find…',
    keybinding: 'Cmd+F',
    handler: () => {
      seedFromSelection(findState, tm)
      findState.open('find')
    },
  })
  commands.register({
    id: 'find.replace',
    label: 'Find and Replace…',
    keybinding: 'Cmd+Alt+F',
    handler: () => {
      seedFromSelection(findState, tm)
      findState.open('replace')
    },
  })
  commands.register({
    id: 'find.next',
    label: 'Find Next',
    keybinding: 'Cmd+G',
    handler: () => findState.next(),
  })
  commands.register({
    id: 'find.prev',
    label: 'Find Previous',
    keybinding: 'Cmd+Shift+G',
    handler: () => findState.prev(),
  })
  commands.register({
    id: 'find.replaceOne',
    label: 'Replace',
    handler: () => findState.replaceOne(),
  })
  commands.register({
    id: 'find.replaceAll',
    label: 'Replace All',
    handler: () => {
      findState.replaceAll()
    },
  })
  commands.register({
    id: 'find.close',
    label: 'Close Find',
    handler: () => findState.close(),
  })
}
