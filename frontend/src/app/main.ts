import '../styles/tokens.css'
import '../styles/base.css'
import { createEditor } from '../editor/createEditor'
import { Workspace } from './workspace'
import { createViewController } from './viewMode'
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

const editorScroll = editorEl.closest('.editor-scroll') as HTMLElement | null
const editorOuter = editorScroll?.parentElement
if (!editorScroll || !editorOuter) throw new Error('.editor-scroll mount point missing')

const sourceParent = document.createElement('div')
sourceParent.className = 'source-view'
editorOuter.insertBefore(sourceParent, editorScroll.nextSibling)

const hybridContainer = editorScroll

const bubbleRefs = createBubbleMenu()
document.body.appendChild(bubbleRefs.root)

let toolbar: { refresh: () => void } | null = null
let statusbar: { refresh: () => void } | null = null

function handleContentChange(): void {
  ws.setModified(true)
  statusbar?.refresh()
  toolbar?.refresh()
}

const editor = createEditor({
  element: editorEl,
  bubbleMenuElement: bubbleRefs.root,
  onUpdate: handleContentChange,
  onSelectionUpdate: () => {
    toolbar?.refresh()
  },
})

const ws = new Workspace(editor)
ws.viewController = createViewController({
  editor,
  hybridContainer,
  sourceParent,
})
ws.viewController.onContentChange(handleContentChange)
ws.viewController.onModeChange(() => {
  toolbar?.refresh()
  statusbar?.refresh()
})

registerCommands(ws)
installKeymap()
mountTitle(ws)
mountMenubar()
toolbar = mountToolbar(ws)
statusbar = mountStatusbar(ws)
bindBubbleMenu(bubbleRefs, ws)
mountCodeBlockLangPicker(editor)
mountTableToolbar(editor)
bindCanvasClick(editor)

toolbar.refresh()
statusbar.refresh()
