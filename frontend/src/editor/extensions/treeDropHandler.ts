import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { childLinksForFolder, relativeLinkPath } from '../../services/workspace'
import { log } from '../../services/log'

/**
 * Custom MIMEs the file tree uses for drags. The drop handler bails out
 * unless one of these is present in the dataTransfer, so unrelated drops
 * (text, image, external Finder drag) fall through to TipTap's defaults.
 */
const FILE_DRAG_MIME = 'application/x-markdownmd-path'
const FOLDER_DRAG_MIME = 'application/x-markdownmd-folder-path'

export interface TreeDropHandlerOptions {
  /**
   * Returns the receiving tab's filePath (or null for Untitled). Used as
   * the `fromFile` reference for relative path computation. Threaded
   * through createEditor by TabManager so the same extension instance can
   * see the tab's path as it changes (rename, save-as).
   */
  getSourcePath: () => string | null
}

function basenameNoExt(path: string): string {
  const last = path.split(/[/\\]+/).filter(Boolean).pop() ?? path
  return last.replace(/\.(md|mdx|markdown)$/i, '')
}

function encodeHref(href: string): string {
  // URL-encode each path segment but keep separators. file:// URLs already
  // have correct shape from RelativeLinkPath; just leave them alone.
  if (href.startsWith('file://')) return href
  return href
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%2F/g, '/'))
    .join('/')
}

/**
 * TipTap extension that turns drops from the file tree into markdown content.
 *
 * Two flavors of drop are handled via distinct MIMEs:
 *   - File drag → insert a Link-marked text node at the drop position.
 *   - Folder drag → insert a bulletList of links to direct markdown children
 *     (non-recursive, mirroring double-click-open-all's scope).
 *
 * Both branches:
 *   - Use view.posAtCoords for the drop position (fallback: end of doc).
 *   - Call Go-side helpers for path resolution (handles Windows / cross-drive
 *     / untitled cases uniformly).
 *   - Fire `explorer:dismiss` on success so the panel closes — the user has
 *     committed an action and the writing surface should be clear.
 *
 * dragover sets dropEffect to 'copy' so the cursor shows the right hint and
 * the drop event actually fires.
 */
export const TreeDropHandler = Extension.create<TreeDropHandlerOptions>({
  name: 'treeDropHandler',

  addOptions() {
    return {
      getSourcePath: () => null,
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const getSourcePath = this.options.getSourcePath

    async function insertFileLink(path: string, pos: number, fromFile: string): Promise<void> {
      try {
        const href = await relativeLinkPath(fromFile, path)
        if (!fromFile) {
          log.warn(
            'explorer',
            'inserted absolute path; save the document to use relative paths',
          )
        }
        editor
          .chain()
          .focus()
          .insertContentAt(pos, [
            {
              type: 'text',
              text: basenameNoExt(path),
              marks: [{ type: 'link', attrs: { href: encodeHref(href) } }],
            },
          ])
          .run()
        window.dispatchEvent(new CustomEvent('explorer:dismiss'))
      } catch (err) {
        log.warn('explorer', `drop: ${(err as Error).message ?? String(err)}`)
      }
    }

    async function insertFolderList(
      folder: string,
      pos: number,
      fromFile: string,
    ): Promise<void> {
      try {
        const links = await childLinksForFolder(folder, fromFile)
        if (links.length === 0) {
          log.info('explorer', `no markdown files in ${folder}`)
          return
        }
        if (!fromFile) {
          log.warn(
            'explorer',
            'inserted absolute paths; save the document to use relative paths',
          )
        }
        // bulletList → listItem → paragraph → Link-marked text.
        // tiptap-markdown serialises this as `- [name](href)\n`.
        const bulletList = {
          type: 'bulletList',
          content: links.map((l) => ({
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: l.name,
                    marks: [{ type: 'link', attrs: { href: encodeHref(l.href) } }],
                  },
                ],
              },
            ],
          })),
        }
        editor.chain().focus().insertContentAt(pos, bulletList).run()
        window.dispatchEvent(new CustomEvent('explorer:dismiss'))
      } catch (err) {
        log.warn('explorer', `folder drop: ${(err as Error).message ?? String(err)}`)
      }
    }

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            dragover(_view, event) {
              const dt = event.dataTransfer
              if (!dt) return false
              const types = Array.from(dt.types)
              if (!types.includes(FILE_DRAG_MIME) && !types.includes(FOLDER_DRAG_MIME)) {
                return false
              }
              dt.dropEffect = 'copy'
              event.preventDefault()
              return true
            },
          },
          handleDrop(view, event) {
            const dt = event.dataTransfer
            if (!dt) return false
            const filePath = dt.getData(FILE_DRAG_MIME)
            const folderPath = dt.getData(FOLDER_DRAG_MIME)
            if (!filePath && !folderPath) return false

            event.preventDefault()

            const coordsHit = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })
            const pos = coordsHit?.pos ?? view.state.doc.content.size
            const fromFile = getSourcePath() ?? ''

            if (filePath) {
              void insertFileLink(filePath, pos, fromFile)
            } else if (folderPath) {
              void insertFolderList(folderPath, pos, fromFile)
            }
            return true
          },
        },
      }),
    ]
  },
})
