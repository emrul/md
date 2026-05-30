import type { Editor } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'

// Replace the editor's state with a fresh one carrying the same doc and
// selection but with all plugin state re-initialised — notably the history
// plugin, so previous transactions can no longer be undone.
//
// Used right after loading content from disk: the load itself is a `setContent`
// transaction that the history plugin would otherwise record, letting the user
// undo *past* their edits and blank the document. We also use it to make the
// dirty flag track `undoDepth(state) !== tab.savedAtDepth` — clearing makes the
// loaded state the baseline (depth 0).
export function clearEditorHistory(editor: Editor): void {
  const { state, view } = editor
  const fresh = EditorState.create({
    schema: state.schema,
    doc: state.doc,
    selection: state.selection,
    plugins: state.plugins,
    storedMarks: state.storedMarks,
  })
  view.updateState(fresh)
}
