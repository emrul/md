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
  function withEditor(fn: (editor: import('@tiptap/core').Editor) => void): () => void {
    return () => {
      const tab = tm.active()
      if (!tab) return
      fn(tab.editor)
    }
  }

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
    handler: withEditor((e) => e.chain().focus().toggleBold().run()),
  })
  commands.register({
    id: 'format.italic',
    label: 'Italic',
    keybinding: 'Cmd+I',
    handler: withEditor((e) => e.chain().focus().toggleItalic().run()),
  })
  commands.register({
    id: 'format.strike',
    label: 'Strikethrough',
    handler: withEditor((e) => e.chain().focus().toggleStrike().run()),
  })
  commands.register({
    id: 'format.code',
    label: 'Inline Code',
    keybinding: 'Cmd+E',
    handler: withEditor((e) => e.chain().focus().toggleCode().run()),
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
    handler: withEditor((e) => e.chain().focus().setParagraph().run()),
  })
  commands.register({
    id: 'format.heading1',
    label: 'Heading 1',
    keybinding: 'Cmd+Alt+1',
    handler: withEditor((e) => e.chain().focus().toggleHeading({ level: 1 }).run()),
  })
  commands.register({
    id: 'format.heading2',
    label: 'Heading 2',
    keybinding: 'Cmd+Alt+2',
    handler: withEditor((e) => e.chain().focus().toggleHeading({ level: 2 }).run()),
  })
  commands.register({
    id: 'format.heading3',
    label: 'Heading 3',
    keybinding: 'Cmd+Alt+3',
    handler: withEditor((e) => e.chain().focus().toggleHeading({ level: 3 }).run()),
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

  // History
  commands.register({
    id: 'edit.undo',
    label: 'Undo',
    handler: withEditor((e) => e.chain().focus().undo().run()),
  })
  commands.register({
    id: 'edit.redo',
    label: 'Redo',
    handler: withEditor((e) => e.chain().focus().redo().run()),
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
