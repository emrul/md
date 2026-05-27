import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { BubbleMenu } from '@tiptap/extension-bubble-menu'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TableRow from '@tiptap/extension-table-row'
import { AlignedTable } from './extensions/AlignedTable'
import { AlignedTableCell, AlignedTableHeader } from './extensions/TableCellAlign'
import { Markdown } from 'tiptap-markdown'
import { EnhancedCodeBlock } from './extensions/CodeBlock'
import { lowlight } from './extensions/lowlight'
import { MathInline, MathBlock } from './extensions/Math'
import { HybridReveal } from './extensions/hybrid/HybridReveal'
import { HeadingCycle } from './extensions/HeadingCycle'
import { SlashMenu } from './extensions/slash/SlashMenu'
import './extensions/task-list.css'
import './extensions/table.css'
import { bubbleMenuShouldShow } from '../ui/bubbleMenu'
import './editor.css'

export interface CreateEditorOptions {
  element: HTMLElement
  bubbleMenuElement: HTMLElement
  onUpdate: () => void
  onSelectionUpdate: () => void
}

export function createEditor(opts: CreateEditorOptions): Editor {
  return new Editor({
    element: opts.element,
    autofocus: 'start',
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      EnhancedCodeBlock.configure({ lowlight, defaultLanguage: null }),
      TaskList,
      TaskItem.configure({ nested: true }),
      AlignedTable.configure({ resizable: true, HTMLAttributes: { class: 'mdmd-table' } }),
      TableRow,
      AlignedTableHeader,
      AlignedTableCell,
      MathInline,
      MathBlock,
      HybridReveal,
      HeadingCycle,
      SlashMenu,
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      CharacterCount,
      BubbleMenu.configure({
        element: opts.bubbleMenuElement,
        shouldShow: bubbleMenuShouldShow,
        updateDelay: 0,
        tippyOptions: {
          appendTo: () => document.body,
          duration: 0,
        },
      }),
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    onUpdate: opts.onUpdate,
    onSelectionUpdate: opts.onSelectionUpdate,
  })
}
