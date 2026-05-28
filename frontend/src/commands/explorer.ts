import type { TabManager } from '../app/tabManager'
import type { TreeMount } from '../ui/explorer/Tree'
import { commands } from './registry'
import { OpenInNewWindow, RevealInFinder } from '../app/ipc'
import { openPaths } from '../services/files'
import { log } from '../services/log'

interface Args {
  path: string
}

/**
 * Register all `explorer.*` commands. Right-click menus in menu.go emit
 * `command` events with `{ id, args: { path } }`; the dispatcher in
 * app/main.ts routes them through commands.execute. args.path is the
 * absolute path of the right-clicked row.
 *
 * Inline editing (rename / new file / new folder) lives in the Tree because
 * WKWebView eats window.prompt silently. These commands delegate to the
 * tree's begin* methods, which insert an <input> into the row and commit on
 * Enter.
 */
export function registerExplorerCommands(tm: TabManager, tree: TreeMount): void {

  commands.register<Args>({
    id: 'explorer.revealInOS',
    label: 'Show in Finder',
    handler: (args) => {
      if (!args?.path) return
      void RevealInFinder(args.path).catch((err: Error) => {
        log.warn('explorer', `reveal: ${err.message ?? String(err)}`)
      })
    },
  })

  commands.register<Args>({
    id: 'explorer.copyPath',
    label: 'Copy Path',
    handler: (args) => {
      if (!args?.path) return
      void navigator.clipboard.writeText(args.path).catch((err: Error) => {
        log.warn('explorer', `copy path: ${err.message ?? String(err)}`)
      })
    },
  })

  commands.register<Args>({
    id: 'explorer.openInNewWindow',
    label: 'Open in New Window',
    handler: (args) => {
      if (!args?.path) return
      void OpenInNewWindow(args.path).catch((err: Error) => {
        log.warn('explorer', `open in window: ${err.message ?? String(err)}`)
      })
    },
  })

  commands.register<Args>({
    id: 'explorer.newFile',
    label: 'New File',
    handler: (args) => {
      if (!args?.path) return
      void tree.beginNewFile(args.path)
    },
  })

  commands.register<Args>({
    id: 'explorer.newFolder',
    label: 'New Folder',
    handler: (args) => {
      if (!args?.path) return
      void tree.beginNewFolder(args.path)
    },
  })

  commands.register<Args>({
    id: 'explorer.rename',
    label: 'Rename',
    handler: (args) => {
      if (!args?.path) return
      void tree.beginRename(args.path)
    },
  })

  commands.register<Args>({
    id: 'explorer.refresh',
    label: 'Refresh',
    handler: () => {
      void tree.refresh()
    },
  })

  commands.register<Args>({
    id: 'explorer.openAllMarkdown',
    label: 'Open all markdown files',
    handler: async (args) => {
      if (!args?.path) return
      const mdPaths = await tree.collectMarkdownChildren(args.path)
      if (mdPaths.length === 0) {
        log.info('explorer', `no markdown files in ${args.path}`)
        return
      }
      await openPaths(tm, mdPaths)
    },
  })
}
