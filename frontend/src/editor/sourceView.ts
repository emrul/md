import { EditorState, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import './source-view.css'

function fencedLineDeco(isFirst: boolean, isLast: boolean): Decoration {
  const classes = ['cm-fenced-code']
  if (isFirst) classes.push('cm-fenced-code-first')
  if (isLast) classes.push('cm-fenced-code-last')
  return Decoration.line({ attributes: { class: classes.join(' ') } })
}

function buildFencedCodeDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'FencedCode') return
        const startLine = doc.lineAt(node.from)
        const endLine = doc.lineAt(Math.min(node.to, doc.length))
        for (let n = startLine.number; n <= endLine.number; n++) {
          const line = doc.line(n)
          builder.add(
            line.from,
            line.from,
            fencedLineDeco(n === startLine.number, n === endLine.number),
          )
        }
      },
    })
  }
  return builder.finish()
}

const fencedCodeBackground = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildFencedCodeDecos(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildFencedCodeDecos(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'tok-heading tok-heading-1' },
  { tag: t.heading2, class: 'tok-heading tok-heading-2' },
  { tag: t.heading3, class: 'tok-heading tok-heading-3' },
  { tag: t.heading4, class: 'tok-heading tok-heading-4' },
  { tag: t.heading5, class: 'tok-heading tok-heading-5' },
  { tag: t.heading6, class: 'tok-heading tok-heading-6' },
  { tag: t.strong, class: 'tok-strong' },
  { tag: t.emphasis, class: 'tok-emphasis' },
  { tag: t.strikethrough, class: 'tok-strikethrough' },
  { tag: t.link, class: 'tok-link' },
  { tag: t.url, class: 'tok-url' },
  { tag: t.monospace, class: 'tok-code' },
  { tag: t.contentSeparator, class: 'tok-hr' },
  { tag: t.quote, class: 'tok-quote' },
  { tag: t.list, class: 'tok-list' },
  { tag: t.processingInstruction, class: 'tok-marker' },
  { tag: t.meta, class: 'tok-marker' },
])

export interface SourceViewOptions {
  parent: HTMLElement
  doc: string
  onUpdate?: (doc: string) => void
}

export interface SourceView {
  view: EditorView
  getValue(): string
  setValue(text: string): void
  focus(): void
  destroy(): void
}

export function createSourceView(opts: SourceViewOptions): SourceView {
  let lastDoc = opts.doc

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown(),
        syntaxHighlighting(markdownHighlight),
        fencedCodeBackground,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const text = u.state.doc.toString()
          if (text === lastDoc) return
          lastDoc = text
          opts.onUpdate?.(text)
        }),
      ],
    }),
  })

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (text: string) => {
      lastDoc = text
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}
