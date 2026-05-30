import { Node, mergeAttributes } from '@tiptap/core'
import { InputRule } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type katex from 'katex'
import 'katex/dist/katex.min.css'
import { mathPlugin } from './math-md-it'
import './math.css'

type Katex = typeof katex
let katexPromise: Promise<Katex> | null = null

function getKatex(): Promise<Katex> {
  if (!katexPromise) {
    katexPromise = import('katex').then((m) => m.default)
  }
  return katexPromise
}

// Fire-and-forget render: the target shows a tiny placeholder while KaTeX
// loads on first use (~one-time cost), then renders in-place. Subsequent
// renders resolve in microseconds because the promise is cached.
function renderKatex(latex: string, displayMode: boolean, target: HTMLElement): void {
  if (!katexPromise) {
    target.textContent = '…'
    target.classList.remove('is-error')
  }
  const requestedLatex = latex
  void getKatex().then((k) => {
    // Bail if the target was already updated for a newer latex value.
    if (
      target.dataset.lastLatex === requestedLatex &&
      target.dataset.lastMode === String(displayMode)
    ) {
      return
    }
    target.dataset.lastLatex = requestedLatex
    target.dataset.lastMode = String(displayMode)
    try {
      k.render(requestedLatex, target, {
        displayMode,
        throwOnError: false,
        output: 'html',
        strict: 'ignore',
      })
      target.classList.remove('is-error')
    } catch (err) {
      target.textContent = '⚠ ' + (err instanceof Error ? err.message : String(err))
      target.classList.add('is-error')
    }
  })
}

// Rendered-HTML cache so repeated decoration recomputes don't re-run KaTeX for
// the same expression. KaTeX output is deterministic per latex string.
const inlineMathCache = new Map<string, string>()

// A span with `latex` rendered inline by KaTeX. Used as a widget decoration in
// source blocks (hybrid mode), where math is raw text rather than a node.
export function renderInlineMath(latex: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'sb-math-rendered'
  const cached = inlineMathCache.get(latex)
  if (cached !== undefined) {
    span.innerHTML = cached
    return span
  }
  span.textContent = '…'
  void getKatex().then((k) => {
    let html = ''
    try {
      html = k.renderToString(latex, { throwOnError: false, output: 'html', strict: 'ignore' })
    } catch {
      html = ''
    }
    inlineMathCache.set(latex, html)
    if (html) {
      span.innerHTML = html
    } else {
      span.textContent = `$${latex}$`
      span.classList.add('sb-math-error')
    }
  })
  return span
}

interface MathStorage {
  markdown: {
    serialize: (
      state: { write: (s: string) => void; closeBlock: (n: PMNode) => void },
      node: PMNode,
    ) => void
    parse: { setup: (md: import('markdown-it').default) => void }
  }
}

export const MathInline = Node.create<unknown, MathStorage>({
  name: 'mathInline',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) =>
          el.getAttribute('data-math-inline') ?? el.getAttribute('data-latex') ?? '',
        renderHTML: (attrs: { latex?: string }) => ({ 'data-math-inline': attrs.latex ?? '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'math-inline' })]
  },

  addNodeView() {
    return ({ node, editor, getPos }) =>
      buildMathNodeView({
        node,
        editor,
        getPos,
        displayMode: false,
        nodeName: 'mathInline',
      })
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|[^\\$])\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1]?.trim()
          if (!latex) return
          const dollarOffset = match[0].lastIndexOf('$', match[0].length - 2)
          const start = range.from + dollarOffset
          state.tr.replaceRangeWith(start, range.to, this.type.create({ latex }))
        },
      }),
    ]
  },

  addStorage(): MathStorage {
    return {
      markdown: {
        serialize(state, node) {
          state.write(`$${node.attrs.latex}$`)
        },
        parse: { setup: mathPlugin },
      },
    }
  },
})

export const MathBlock = Node.create<unknown, MathStorage>({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  defining: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) =>
          el.getAttribute('data-math-block') ?? el.getAttribute('data-latex') ?? '',
        renderHTML: (attrs: { latex?: string }) => ({ 'data-math-block': attrs.latex ?? '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'math-block' })]
  },

  addNodeView() {
    return ({ node, editor, getPos }) =>
      buildMathNodeView({
        node,
        editor,
        getPos,
        displayMode: true,
        nodeName: 'mathBlock',
      })
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          state.tr.replaceRangeWith(range.from, range.to, this.type.create({ latex: '' }))
        },
      }),
    ]
  },

  addStorage(): MathStorage {
    return {
      markdown: {
        serialize(state, node) {
          state.write(`$$\n${node.attrs.latex}\n$$`)
          state.closeBlock(node)
        },
        parse: { setup: mathPlugin },
      },
    }
  },
})

interface MathNodeViewArgs {
  node: PMNode
  editor: Editor
  getPos: () => number | undefined
  displayMode: boolean
  nodeName: 'mathInline' | 'mathBlock'
}

function buildMathNodeView(args: MathNodeViewArgs): {
  dom: HTMLElement
  update(updatedNode: PMNode): boolean
  selectNode(): void
  deselectNode(): void
  ignoreMutation: (m: MutationRecord | { type: 'selection' }) => boolean
  stopEvent: (e: Event) => boolean
  destroy(): void
} {
  const { node, editor, displayMode, nodeName, getPos } = args

  const dom = document.createElement(displayMode ? 'div' : 'span')
  dom.className = displayMode ? 'math-block' : 'math-inline'
  dom.setAttribute('data-math-active', 'false')

  const rendered = document.createElement(displayMode ? 'div' : 'span')
  rendered.className = 'math-rendered'

  const editor_el = document.createElement(displayMode ? 'textarea' : 'input') as
    | HTMLInputElement
    | HTMLTextAreaElement
  editor_el.className = 'math-input'
  editor_el.spellcheck = false

  if (editor_el instanceof HTMLInputElement) editor_el.type = 'text'
  if (editor_el instanceof HTMLTextAreaElement) editor_el.rows = 3

  dom.append(rendered, editor_el)

  const renderNow = (latex: string): void => {
    if (!latex.trim()) {
      rendered.textContent = displayMode ? 'Empty math block' : '∅'
      rendered.classList.add('is-empty')
      return
    }
    rendered.classList.remove('is-empty')
    renderKatex(latex, displayMode, rendered)
  }

  renderNow(node.attrs.latex as string)
  editor_el.value = (node.attrs.latex as string) ?? ''

  let editing = false

  const enterEdit = (): void => {
    if (editing) return
    editing = true
    dom.setAttribute('data-math-active', 'true')
    editor_el.value = (currentLatex() as string) ?? ''
    requestAnimationFrame(() => {
      editor_el.focus()
      editor_el.select()
    })
  }

  const exitEdit = (commit: boolean): void => {
    if (!editing) return
    editing = false
    dom.setAttribute('data-math-active', 'false')
    if (commit) {
      const pos = getPos()
      if (typeof pos === 'number') {
        const latex = editor_el.value
        const tr = editor.state.tr.setNodeAttribute(pos, 'latex', latex)
        editor.view.dispatch(tr)
        renderNow(latex)
      }
    }
  }

  const currentLatex = (): string => {
    const pos = getPos()
    if (typeof pos !== 'number') return (node.attrs.latex as string) ?? ''
    const current = editor.state.doc.nodeAt(pos)
    return (current?.attrs.latex as string | undefined) ?? ''
  }

  editor_el.addEventListener('input', () => {
    renderNow(editor_el.value)
  })

  editor_el.addEventListener('blur', () => exitEdit(true))

  editor_el.addEventListener('keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      exitEdit(true)
      editor.commands.focus()
    } else if (e.key === 'Enter' && !displayMode) {
      e.preventDefault()
      exitEdit(true)
      const pos = getPos()
      if (typeof pos === 'number') {
        editor
          .chain()
          .focus()
          .setTextSelection(pos + 1)
          .run()
      }
    } else if (e.key === 'Enter' && displayMode && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      exitEdit(true)
      editor.commands.focus()
    }
  }) as EventListener)

  dom.addEventListener('mousedown', (e) => {
    // Atom nodes get NodeSelection on click; we hijack to enter edit mode
    // and prevent PM from positioning a cursor through us.
    if (editing) return
    if (e.target === editor_el) return
    e.preventDefault()
    const pos = getPos()
    if (typeof pos !== 'number') return
    const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))
    editor.view.dispatch(tr)
    enterEdit()
  })

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type.name !== nodeName) return false
      const latex = (updatedNode.attrs.latex as string) ?? ''
      if (!editing && latex !== editor_el.value) {
        editor_el.value = latex
        renderNow(latex)
      }
      return true
    },
    selectNode() {
      // PM has selected this atom — enter edit mode.
      enterEdit()
    },
    deselectNode() {
      exitEdit(true)
    },
    ignoreMutation(mutation) {
      if (mutation.type === 'selection') return false
      return true
    },
    stopEvent(event) {
      // Keep keyboard / input events local to the math input.
      const target = event.target as EventTarget | null
      if (target === editor_el) return true
      return false
    },
    destroy() {
      // No-op
    },
  }
}

// Re-export TextSelection so callers don't pull from pm/state separately if
// they're extending math behaviour.
export { TextSelection }
