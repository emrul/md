// Standalone editor test harness — mounts just the TipTap editor (no Wails
// shell) so it can run in a plain browser and be driven by a headless Chrome
// (real CDP key events) for behavioural tests of the hybrid/source-block model.
// Served by Vite at /harness.html; not part of the production build.
import '../styles/tokens.css'
import '../styles/base.css'
import { createEditor } from '../editor/createEditor'
import { getMarkdown, setMarkdown } from '../editor/serialize/markdown'
import { linkHrefAt } from '../editor/extensions/LinkOpen'
import { replaceSelectionWithMarkdown } from '../editor/extensions/MarkdownPaste'
import { getRenderMode, switchRenderMode, type RenderMode } from '../editor/mode'

// Minimal Wails-runtime stub so any binding-importing module doesn't throw if
// it touches window._wails at load. The editor core doesn't call bindings at
// construction; this is just belt-and-suspenders.
interface WailsStub {
  invoke: () => Promise<unknown>
  environment: { OS: string; Arch: string; Debug: boolean }
  flags: Record<string, unknown>
}
const w = window as unknown as { _wails?: WailsStub }
w._wails ??= {
  invoke: () => Promise.resolve(),
  environment: { OS: 'darwin', Arch: 'arm64', Debug: true },
  flags: {},
}

const element = document.getElementById('editor') as HTMLElement
const bubble = document.getElementById('bubble') as HTMLElement
const status = document.getElementById('status') as HTMLElement

let harnessReadOnly = false
const editor = createEditor({
  element,
  bubbleMenuElement: bubble,
  onUpdate: () => {},
  onSelectionUpdate: () => {},
  getSourcePath: () => null,
  getReadOnly: () => harnessReadOnly,
})

// Test hooks for the headless driver.
const harness = {
  editor,
  // Replace the whole document with the given markdown (via the real hybrid
  // load path, so paragraphs/headings become source blocks).
  setMarkdown(md: string): void {
    setMarkdown(editor, md)
  },
  // Serialize the document back to markdown.
  getMarkdown(): string {
    return getMarkdown(editor)
  },
  // Current caret position as { from, to } in ProseMirror coords.
  selection(): { from: number; to: number } {
    const { from, to } = editor.state.selection
    return { from, to }
  },
  // Insert a source block (the spike) at the cursor.
  insertSourceBlock(text?: string): void {
    editor.chain().focus().insertSourceBlock(text).run()
  },
  // Drive the markdown-paste transformation at the cursor (the same code the
  // paste handler runs, minus the real ClipboardEvent a headless driver can't
  // synthesize). Returns whether it handled the text.
  pasteMarkdown(text: string): boolean {
    return replaceSelectionWithMarkdown(editor.view, editor, text)
  },
  // Resolve the link target at a document position (cmd/ctrl-click logic).
  linkHrefAt(pos: number): string | null {
    return linkHrefAt(editor.state, pos)
  },
  // Toggle the read-only lock the way a tab does: flip the guard flag and the
  // editor's editable state together.
  setReadOnly(on: boolean): void {
    harnessReadOnly = on
    editor.setEditable(!on)
  },
  // Render-mode switching (in-place WYSIWYG↔Hybrid conversion).
  renderMode(): RenderMode {
    return getRenderMode(editor)
  },
  switchRenderMode(mode: RenderMode): void {
    switchRenderMode(editor, mode)
  },
}
;(window as unknown as { __harness: typeof harness }).__harness = harness

status.textContent = 'editor ready — window.__harness available'
