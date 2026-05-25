import type { Workspace } from '../app/workspace'
import { commands } from './registry'
import * as files from '../services/files'

export { commands } from './registry'
export { installKeymap } from './keymap'

export function registerCommands(ws: Workspace): void {
  const editor = ws.editor

  // File
  commands.register({
    id: 'file.new',
    label: 'New',
    keybinding: 'Cmd+N',
    handler: () => files.newFile(ws),
  })
  commands.register({
    id: 'file.open',
    label: 'Open…',
    keybinding: 'Cmd+O',
    handler: () => files.openFile(ws),
  })
  commands.register({
    id: 'file.save',
    label: 'Save',
    keybinding: 'Cmd+S',
    handler: () => files.saveFile(ws),
  })
  commands.register({
    id: 'file.saveAs',
    label: 'Save As…',
    keybinding: 'Cmd+Shift+S',
    handler: () => files.saveFileAs(ws),
  })

  // Marks
  commands.register({
    id: 'format.bold',
    label: 'Bold',
    keybinding: 'Cmd+B',
    handler: () => editor.chain().focus().toggleBold().run(),
  })
  commands.register({
    id: 'format.italic',
    label: 'Italic',
    keybinding: 'Cmd+I',
    handler: () => editor.chain().focus().toggleItalic().run(),
  })
  commands.register({
    id: 'format.strike',
    label: 'Strikethrough',
    handler: () => editor.chain().focus().toggleStrike().run(),
  })
  commands.register({
    id: 'format.code',
    label: 'Inline Code',
    keybinding: 'Cmd+E',
    handler: () => editor.chain().focus().toggleCode().run(),
  })
  commands.register({
    id: 'format.clearAll',
    label: 'Clear Formatting',
    handler: () => editor.chain().focus().unsetAllMarks().run(),
  })

  // Blocks
  commands.register({
    id: 'format.heading1',
    label: 'Heading 1',
    keybinding: 'Cmd+Alt+1',
    handler: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  })
  commands.register({
    id: 'format.heading2',
    label: 'Heading 2',
    keybinding: 'Cmd+Alt+2',
    handler: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  })
  commands.register({
    id: 'format.heading3',
    label: 'Heading 3',
    keybinding: 'Cmd+Alt+3',
    handler: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  })
  commands.register({
    id: 'format.bulletList',
    label: 'Bullet List',
    keybinding: 'Cmd+Shift+8',
    handler: () => editor.chain().focus().toggleBulletList().run(),
  })
  commands.register({
    id: 'format.orderedList',
    label: 'Ordered List',
    keybinding: 'Cmd+Shift+7',
    handler: () => editor.chain().focus().toggleOrderedList().run(),
  })
  commands.register({
    id: 'format.blockquote',
    label: 'Blockquote',
    keybinding: 'Cmd+Shift+B',
    handler: () => editor.chain().focus().toggleBlockquote().run(),
  })
  commands.register({
    id: 'format.codeBlock',
    label: 'Code Block',
    keybinding: 'Cmd+Shift+K',
    handler: () => editor.chain().focus().toggleCodeBlock().run(),
  })
  commands.register({
    id: 'format.horizontalRule',
    label: 'Horizontal Rule',
    handler: () => editor.chain().focus().setHorizontalRule().run(),
  })

  // Insert
  commands.register({
    id: 'insert.link',
    label: 'Link…',
    keybinding: 'Cmd+K',
    handler: () => files.insertLink(ws),
  })
  commands.register({
    id: 'insert.image',
    label: 'Image…',
    handler: () => files.insertImage(ws),
  })

  // History
  commands.register({
    id: 'edit.undo',
    label: 'Undo',
    handler: () => editor.chain().focus().undo().run(),
  })
  commands.register({
    id: 'edit.redo',
    label: 'Redo',
    handler: () => editor.chain().focus().redo().run(),
  })
}
