import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

function parentHeading(editor: { state: { selection: { $from: { parent: PMNode } } } }): PMNode | null {
  const parent = editor.state.selection.$from.parent
  return parent.type.name === 'heading' ? parent : null
}

export const HeadingCycle = Extension.create({
  name: 'headingCycle',

  addKeyboardShortcuts() {
    const cycleForward = (): boolean => {
      const { selection } = this.editor.state
      const parent = selection.$from.parent
      if (parent.type.name === 'heading') {
        const current = (parent.attrs.level as number | undefined) ?? 1
        const next = current >= 6 ? 1 : current + 1
        return this.editor.chain().setNode('heading', { level: next }).run()
      }
      if (parent.type.name === 'paragraph') {
        return this.editor.chain().setNode('heading', { level: 1 }).run()
      }
      return false
    }

    const cycleBackward = (): boolean => {
      const { selection } = this.editor.state
      const parent = selection.$from.parent
      if (parent.type.name === 'heading') {
        const current = (parent.attrs.level as number | undefined) ?? 1
        if (current <= 1) return this.editor.chain().setNode('paragraph').run()
        return this.editor.chain().setNode('heading', { level: current - 1 }).run()
      }
      return false
    }

    return {
      'Mod-]': cycleForward,
      'Mod-[': cycleBackward,
      '#': () => {
        const { selection } = this.editor.state
        if (!selection.empty) return false
        const $pos = selection.$from
        const heading = parentHeading(this.editor)
        if (!heading) return false
        if ($pos.parentOffset !== 0) return false
        const current = (heading.attrs.level as number | undefined) ?? 1
        const next = current >= 6 ? 1 : current + 1
        return this.editor
          .chain()
          .setNode('heading', { level: next })
          .setTextSelection($pos.start())
          .run()
      },
    }
  },
})
