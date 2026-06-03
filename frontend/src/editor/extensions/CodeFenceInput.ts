import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

// Open a fenced code block when the caret is on a line that is just a code
// fence (``` or ~~~, optionally followed by a language) and Enter is pressed —
// the Typora/MarkText gesture.
//
// Why a keyboard handler instead of the stock CodeBlock input rule: the input
// rule fires on the trailing space of "```lang " and ProseMirror suppresses
// input rules inside `code`-spec blocks, so it never runs in a hybrid source
// block (which is code:true). Handling Enter covers BOTH render modes uniformly
// — a top-level paragraph (WYSIWYG) and a source block (hybrid) — and matches
// the more common "type the fence, press Enter" muscle memory.
const FENCE_RE = /^(?:```|~~~)([A-Za-z0-9_+#-]*)$/

export const CodeFenceInput = Extension.create({
  name: 'codeFenceInput',
  // Beat SourceBlock's Enter (split into a new source block) and the base
  // keymap's paragraph split, both of which would otherwise consume Enter.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection
        const parent = $from.parent
        if (parent.type.name !== 'paragraph' && parent.type.name !== 'sourceBlock') {
          return false
        }
        const m = FENCE_RE.exec(parent.textContent)
        if (!m) return false
        const cbType = state.schema.nodes.codeBlock
        if (!cbType) return false

        // Bail (let Enter fall through) if a code block can't sit where this
        // textblock lives — e.g. an exotic container that disallows it.
        const container = $from.node(-1)
        const index = $from.index(-1)
        if (!container.canReplaceWith(index, index + 1, cbType)) return false

        const lang = m[1] || null
        return this.editor.commands.command(({ tr, dispatch }) => {
          if (dispatch) {
            const start = $from.before()
            const end = $from.after()
            tr.replaceWith(start, end, cbType.create({ language: lang }))
            tr.setSelection(TextSelection.create(tr.doc, start + 1))
            dispatch(tr.scrollIntoView())
          }
          return true
        })
      },
    }
  },
})
