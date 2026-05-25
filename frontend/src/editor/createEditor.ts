import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { BubbleMenu } from '@tiptap/extension-bubble-menu'
import { Markdown } from 'tiptap-markdown'
import { MermaidCodeBlock } from './extensions/MermaidCodeBlock'
import { HybridReveal } from './extensions/hybrid/HybridReveal'
import { HeadingCycle } from './extensions/HeadingCycle'
import { SlashMenu } from './extensions/slash/SlashMenu'
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
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      MermaidCodeBlock,
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
