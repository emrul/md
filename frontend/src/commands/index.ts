import type { Editor } from '@tiptap/core'
import type { TabManager } from '../app/tabManager'
import type { ExplorerState } from '../app/explorerState'
import { commands } from './registry'
import { NewEmptyWindow, OpenLogsWindow } from '../app/ipc'
import * as files from '../services/files'
import * as tabs from '../services/tabs'

export { commands } from './registry'
export { installKeymap } from './keymap'

export function registerCommands(tm: TabManager, explorer: ExplorerState): void {
  // Helper: run a command against the active tab's editor, no-op if no tab.
  function withEditor(fn: (editor: Editor) => void): () => void {
    return () => {
      const tab = tm.active()
      if (!tab) return
      fn(tab.editor)
    }
  }

  // In hybrid mode the caret may sit inside a sourceBlock, which holds raw
  // markdown and disallows marks. There, formatting wraps the selection with
  // literal syntax instead of toggling a ProseMirror mark.
  function inSourceBlock(e: Editor): boolean {
    const { $from } = e.state.selection
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'sourceBlock') return true
    }
    return false
  }
  const formatMark = (delim: string, toggleMark: (e: Editor) => void): (() => void) =>
    withEditor((e) => {
      if (inSourceBlock(e)) e.chain().focus().toggleSourceWrap(delim).run()
      else toggleMark(e)
    })
  // level 0 = paragraph (strip any heading prefix).
  const formatHeading = (level: number): (() => void) =>
    withEditor((e) => {
      if (inSourceBlock(e)) e.chain().focus().toggleSourceHeading(level).run()
      else if (level === 0) e.chain().focus().setParagraph().run()
      else
        e.chain()
          .focus()
          .toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
          .run()
    })

  // File
  commands.register({
    id: 'file.new',
    label: 'New',
    keybinding: 'Cmd+N',
    handler: () => files.newFile(tm),
  })
  commands.register({
    id: 'file.open',
    label: 'Open…',
    keybinding: 'Cmd+O',
    handler: () => files.openFile(tm),
  })
  commands.register<{ path: string }>({
    id: 'files.openPath',
    label: 'Open File',
    handler: (args) => {
      if (args?.path) void files.openPath(tm, args.path)
    },
  })
  commands.register({
    id: 'file.save',
    label: 'Save',
    keybinding: 'Cmd+S',
    handler: () => files.saveFile(tm),
  })
  commands.register({
    id: 'file.saveAs',
    label: 'Save As…',
    keybinding: 'Cmd+Shift+S',
    handler: () => files.saveFileAs(tm),
  })
  commands.register({
    id: 'tab.close',
    label: 'Close Tab',
    keybinding: 'Cmd+W',
    handler: () => {
      void tabs.closeActiveTab(tm)
    },
  })
  commands.register({
    id: 'window.newEmpty',
    label: 'New Window',
    keybinding: 'Cmd+Shift+N',
    handler: () => {
      void NewEmptyWindow()
    },
  })

  // Marks
  commands.register({
    id: 'format.bold',
    label: 'Bold',
    keybinding: 'Cmd+B',
    handler: formatMark('**', (e) => e.chain().focus().toggleBold().run()),
  })
  commands.register({
    id: 'format.italic',
    label: 'Italic',
    keybinding: 'Cmd+I',
    handler: formatMark('_', (e) => e.chain().focus().toggleItalic().run()),
  })
  commands.register({
    id: 'format.strike',
    label: 'Strikethrough',
    handler: formatMark('~~', (e) => e.chain().focus().toggleStrike().run()),
  })
  commands.register({
    id: 'format.code',
    label: 'Inline Code',
    keybinding: 'Cmd+E',
    handler: formatMark('`', (e) => e.chain().focus().toggleCode().run()),
  })
  commands.register({
    id: 'format.clearAll',
    label: 'Clear Formatting',
    handler: withEditor((e) => e.chain().focus().unsetAllMarks().run()),
  })

  // Blocks
  commands.register({
    id: 'format.paragraph',
    label: 'Paragraph',
    handler: formatHeading(0),
  })
  commands.register({
    id: 'format.heading1',
    label: 'Heading 1',
    keybinding: 'Cmd+Alt+1',
    handler: formatHeading(1),
  })
  commands.register({
    id: 'format.heading2',
    label: 'Heading 2',
    keybinding: 'Cmd+Alt+2',
    handler: formatHeading(2),
  })
  commands.register({
    id: 'format.heading3',
    label: 'Heading 3',
    keybinding: 'Cmd+Alt+3',
    handler: formatHeading(3),
  })
  commands.register({
    id: 'format.bulletList',
    label: 'Bullet List',
    keybinding: 'Cmd+Shift+8',
    handler: withEditor((e) => e.chain().focus().toggleBulletList().run()),
  })
  commands.register({
    id: 'format.orderedList',
    label: 'Ordered List',
    keybinding: 'Cmd+Shift+7',
    handler: withEditor((e) => e.chain().focus().toggleOrderedList().run()),
  })
  commands.register({
    id: 'format.taskList',
    label: 'Task List',
    keybinding: 'Cmd+Shift+9',
    handler: withEditor((e) => e.chain().focus().toggleTaskList().run()),
  })
  commands.register({
    id: 'format.blockquote',
    label: 'Blockquote',
    keybinding: 'Cmd+Shift+B',
    handler: withEditor((e) => e.chain().focus().toggleBlockquote().run()),
  })
  commands.register({
    id: 'format.codeBlock',
    label: 'Code Block',
    keybinding: 'Cmd+Shift+K',
    handler: withEditor((e) => e.chain().focus().toggleCodeBlock().run()),
  })
  commands.register({
    id: 'format.horizontalRule',
    label: 'Horizontal Rule',
    handler: withEditor((e) => e.chain().focus().setHorizontalRule().run()),
  })

  // Insert
  commands.register({
    id: 'insert.link',
    label: 'Link…',
    keybinding: 'Cmd+K',
    handler: () => files.insertLink(tm),
  })
  commands.register({
    id: 'insert.image',
    label: 'Image…',
    handler: () => files.insertImage(tm),
  })

  // History — routed through the view controller so source view undoes the
  // editor's history when CM has nothing to undo (and refreshes CM after).
  commands.register({
    id: 'edit.undo',
    label: 'Undo',
    handler: () => {
      tm.active()?.viewController?.undo()
    },
  })
  commands.register({
    id: 'edit.redo',
    label: 'Redo',
    handler: () => {
      tm.active()?.viewController?.redo()
    },
  })

  // View
  commands.register({
    id: 'view.toggleSource',
    label: 'Toggle Source View',
    keybinding: 'Cmd+/',
    handler: () => {
      tm.active()?.viewController?.toggle()
    },
  })
  commands.register({
    id: 'view.openLogs',
    label: 'Logs',
    handler: () => {
      void OpenLogsWindow()
    },
  })
  commands.register({
    id: 'view.toggleExplorer',
    label: 'Toggle Files',
    keybinding: 'Cmd+Shift+E',
    handler: () => explorer.toggleOverlay(),
  })
}
