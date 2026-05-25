import '../styles/tokens.css'
import '../styles/base.css'
import { createEditor } from '../editor/createEditor'
import { Workspace } from './workspace'
import { mountTitle } from './title'
import { registerCommands, installKeymap } from '../commands'
import { mountMenubar } from '../ui/menubar'
import { mountToolbar } from '../ui/toolbar'
import { mountStatusbar } from '../ui/statusbar'
import { bindBubbleMenu, createBubbleMenu } from '../ui/bubbleMenu'
import { mountCodeBlockLangPicker } from '../ui/codeBlockLangPicker'
import { mountTableToolbar } from '../ui/tableToolbar'
import { bindCanvasClick } from './canvasClick'

const editorEl = document.querySelector<HTMLElement>('#editor')
if (!editorEl) throw new Error('#editor mount point missing')

const bubbleRefs = createBubbleMenu()
document.body.appendChild(bubbleRefs.root)

let toolbar: { refresh: () => void } | null = null
let statusbar: { refresh: () => void } | null = null

const editor = createEditor({
  element: editorEl,
  bubbleMenuElement: bubbleRefs.root,
  onUpdate: () => {
    ws.setModified(true)
    statusbar?.refresh()
    toolbar?.refresh()
  },
  onSelectionUpdate: () => {
    toolbar?.refresh()
  },
})

const ws = new Workspace(editor)

registerCommands(ws)
installKeymap()
mountTitle(ws)
mountMenubar()
toolbar = mountToolbar(editor)
statusbar = mountStatusbar(ws)
bindBubbleMenu(bubbleRefs, ws)
mountCodeBlockLangPicker(editor)
mountTableToolbar(editor)
bindCanvasClick(editor)

toolbar.refresh()
statusbar.refresh()
