import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { SOURCE_RAW_STAMP } from './SourceRaw'

export interface ReadOnlyGuardOptions {
  /** Returns whether the owning tab is read-only right now. Read live so the
   * initial content load (before the tab is locked) is never blocked. */
  getReadOnly: () => boolean
}

// Hard backstop for read-only tabs (the bundled Examples). `editor.setEditable
// (false)` stops every DOM-driven edit (typing, paste, drop, IME), but toolbar /
// menu commands dispatch transactions programmatically and would still mutate.
// This rejects any document-changing transaction while the tab is read-only —
// EXCEPT the tagged mode-switch conversions, so toggling Source/WYSIWYG/Hybrid
// to explore the doc still works. The content load runs before the tab is locked
// (getReadOnly() is false then), so it's never filtered.
export const ReadOnlyGuard = Extension.create<ReadOnlyGuardOptions>({
  name: 'readOnlyGuard',

  addOptions() {
    return { getReadOnly: () => false }
  },

  addProseMirrorPlugins() {
    const getReadOnly = this.options.getReadOnly
    return [
      new Plugin({
        filterTransaction(tr) {
          if (!getReadOnly() || !tr.docChanged) return true
          // Mode-switch conversions (mode.ts) tag themselves; let them through so
          // view-mode toggling stays available on a locked doc.
          return tr.getMeta(SOURCE_RAW_STAMP) === true
        },
      }),
    ]
  },
})
