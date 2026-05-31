import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Document from '@tiptap/extension-document'
import Link from '@tiptap/extension-link'
import Code from '@tiptap/extension-code'
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
import { SourceBlock } from './extensions/SourceBlock'
import { RawParagraph, RawHeading, SourceRawInvalidator } from './extensions/SourceRaw'
import { LinkOpen } from './extensions/LinkOpen'
import { LinkPreview } from './extensions/LinkPreview'
import { convertToWysiwyg } from './mode'
import { HeadingCycle } from './extensions/HeadingCycle'
import { SlashMenu } from './extensions/slash/SlashMenu'
import { MarkdownPaste } from './extensions/MarkdownPaste'
import { TreeDropHandler } from './extensions/treeDropHandler'
import { FindHighlight } from './find/FindHighlight'
import './extensions/task-list.css'
import './extensions/table.css'
import { bubbleMenuShouldShow } from '../ui/bubbleMenu'
import { prefs } from '../app/preferences'
import './editor.css'

export interface CreateEditorOptions {
  element: HTMLElement
  bubbleMenuElement: HTMLElement
  onUpdate: () => void
  onSelectionUpdate: () => void
  /**
   * Returns the receiving tab's filePath (or null for Untitled). Used by
   * the drag-from-tree handler to compute relative link paths. Caller
   * threads this in via a closure that sees the Tab created after the
   * editor is constructed.
   */
  getSourcePath?: () => string | null
}

// One schema serves both render modes. `sourceBlock` is listed first in the
// doc's content so it's the ContentMatch default (empty docs / refills are
// source blocks — the common hybrid case), while any block is still accepted in
// any position. Nested containers (list items, table cells, blockquotes) keep
// paragraphs. WYSIWYG mode simply doesn't use source blocks (the initial doc is
// converted to paragraphs and loads route to plain parsing).
const HybridDocument = Document.extend({ content: '(sourceBlock | block)+' })

export function createEditor(opts: CreateEditorOptions): Editor {
  // "source" is a view overlay (ViewController), not a schema; its editor
  // renders as hybrid underneath.
  const initialRender = prefs().editorMode === 'wysiwyg' ? 'wysiwyg' : 'hybrid'
  const editor = new Editor({
    element: opts.element,
    autofocus: 'start',
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        document: false,
        code: false,
        // Replaced by raw-preserving variants so an unedited block keeps its
        // exact source markdown across a hybrid⇄WYSIWYG switch. See SourceRaw.ts.
        paragraph: false,
        heading: false,
      }),
      HybridDocument,
      RawParagraph,
      RawHeading,
      SourceRawInvalidator,
      // Inline code, but allowed to coexist with links. The default Code mark
      // excludes ALL other marks ('_'), which silently dropped the link from a
      // [`code`](url) link on the hybrid→WYSIWYG round-trip (a real markdown
      // pattern — e.g. linking a filename rendered as code). Exclude only the
      // emphasis marks (which can't appear inside literal code) so code+link
      // survives; code still can't combine with bold/italic/strike.
      Code.extend({ excludes: 'bold italic strike' }),
      EnhancedCodeBlock.configure({ lowlight, defaultLanguage: null }),
      TaskList,
      TaskItem.configure({ nested: true }),
      AlignedTable.configure({ resizable: true, HTMLAttributes: { class: 'mdmd-table' } }),
      TableRow,
      AlignedTableHeader,
      AlignedTableCell,
      MathInline,
      MathBlock,
      SourceBlock,
      HeadingCycle,
      SlashMenu,
      MarkdownPaste,
      FindHighlight,
      TreeDropHandler.configure({
        getSourcePath: opts.getSourcePath ?? (() => null),
      }),
      Link.configure({ openOnClick: false }),
      LinkOpen.configure({ getSourcePath: opts.getSourcePath ?? (() => null) }),
      LinkPreview.configure({ getSourcePath: opts.getSourcePath ?? (() => null) }),
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
  // The empty doc starts as a source block (schema default); in WYSIWYG mode
  // convert it to a paragraph so typing/formatting behaves as pure TipTap. This
  // is the baseline representation, so it's not its own undo step.
  if (initialRender === 'wysiwyg') convertToWysiwyg(editor, false)
  return editor
}
