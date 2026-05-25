import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import './mermaid-codeblock.css'
import './code-block.css'

type MermaidApi = {
  initialize(opts: Record<string, unknown>): void
  render(id: string, code: string, container?: HTMLElement): Promise<{ svg: string }>
}

let _mermaid: MermaidApi | null = null
let mermaidSeq = 0
let mermaidQueue: Promise<unknown> = Promise.resolve()

const mermaidScratch = document.createElement('div')
mermaidScratch.style.cssText =
  'position:absolute;visibility:hidden;top:-9999px;left:-9999px;width:1200px'
document.body.appendChild(mermaidScratch)

function enqueueMermaidRender(task: () => Promise<void>): void {
  mermaidQueue = mermaidQueue.then(task, task)
}

async function getMermaid(): Promise<MermaidApi | null> {
  if (_mermaid) return _mermaid
  try {
    const m = (await import('mermaid')) as { default: MermaidApi }
    _mermaid = m.default
    _mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      htmlLabels: true,
      sequence: { htmlLabels: true, useMaxWidth: false },
      flowchart: { htmlLabels: true, useMaxWidth: false },
      gantt: { useMaxWidth: false, barHeight: 22, fontSize: 12 },
      pie: { useMaxWidth: false },
      class: { useMaxWidth: false },
      state: { useMaxWidth: false },
      er: { useMaxWidth: false },
      journey: { useMaxWidth: false },
    })
  } catch (err) {
    console.error('[mermaid] load failed:', err)
  }
  return _mermaid
}

const CODE_INDENT = '  '

export const EnhancedCodeBlock = CodeBlockLowlight.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: () => {
        if (!this.editor.isActive('codeBlock')) return false
        return this.editor.commands.insertContent(CODE_INDENT)
      },
      'Shift-Tab': () => {
        if (!this.editor.isActive('codeBlock')) return false
        const { state, view } = this.editor
        const { $from } = state.selection
        const lineStart = $from.start()
        const before = state.doc.textBetween(lineStart, $from.pos, '\n', '\n')
        const lineOffset = before.lastIndexOf('\n')
        const lineFrom = lineOffset === -1 ? lineStart : lineStart + lineOffset + 1
        const lineText = state.doc.textBetween(lineFrom, $from.pos, '\n', '\n')
        const match = /^( {1,2}|\t)/.exec(lineText)
        if (!match) return true
        const tr = state.tr.delete(lineFrom, lineFrom + match[0].length)
        view.dispatch(tr)
        return true
      },
    }
  },

  addNodeView() {
    return ({
      node,
      editor,
      getPos,
    }: {
      node: PMNode
      editor: Editor
      getPos: () => number | undefined
    }) => {
      const wrapper = document.createElement('div')
      const preview = document.createElement('div')
      const pre = document.createElement('pre')
      const codeEl = document.createElement('code')

      preview.className = 'mermaid-preview'
      preview.textContent = 'Rendering…'
      preview.title = 'Double-click to edit'
      pre.appendChild(codeEl)

      const setCodeLangClass = (lang: string | null | undefined): void => {
        codeEl.className = lang ? `language-${lang} hljs` : 'hljs'
      }

      setCodeLangClass(node.attrs.language)

      let renderTimer: ReturnType<typeof setTimeout> | null = null
      let lastLang: string | null = null
      let lastText: string | null = null
      let destroyed = false

      const doRender = (code: string): void => {
        if (preview.innerHTML === '') preview.textContent = 'Rendering…'
        enqueueMermaidRender(async () => {
          if (destroyed) return
          const md = await getMermaid()
          if (destroyed) return
          if (!md) {
            preview.textContent = '⚠ Mermaid unavailable'
            preview.classList.add('is-error')
            return
          }
          const id = 'mmd' + ++mermaidSeq
          try {
            const { svg } = await md.render(id, code, mermaidScratch)
            if (destroyed) return
            preview.innerHTML = svg
            preview.classList.remove('is-error')
          } catch (err) {
            if (destroyed) return
            const msg = String(err)
              .replace(/<[^>]*>/g, '')
              .trim()
            preview.textContent = '⚠ Mermaid error: ' + msg
            preview.classList.add('is-error')
            console.error('[mermaid]', err)
          }
        })
      }

      const scheduleRender = (n: PMNode): void => {
        const lang = (n.attrs.language as string | null | undefined) ?? null
        const text = n.textContent
        const langChanged = lang !== lastLang
        const textChanged = text !== lastText
        lastLang = lang
        lastText = text

        if (lang === 'mermaid') {
          if (!wrapper.contains(preview)) wrapper.prepend(preview)
          wrapper.className = 'mermaid-block'
          setCodeLangClass('mermaid')
          if (!langChanged && !textChanged) return
          if (renderTimer) clearTimeout(renderTimer)
          const code = text.trim()
          renderTimer = setTimeout(() => doRender(code), 350)
        } else {
          if (langChanged) {
            preview.remove()
            wrapper.className = ''
            setCodeLangClass(lang)
            if (renderTimer) {
              clearTimeout(renderTimer)
              renderTimer = null
            }
          }
        }
      }

      const updateEditingState = (): void => {
        const pos = getPos()
        if (typeof pos !== 'number') return
        const current = editor.state.doc.nodeAt(pos)
        if (!current || current.attrs.language !== 'mermaid') {
          wrapper.classList.remove('is-editing')
          return
        }
        const { from } = editor.state.selection
        const editing = from > pos && from < pos + current.nodeSize
        wrapper.classList.toggle('is-editing', editing)
      }

      const onSelectionUpdate = (): void => updateEditingState()
      editor.on('selectionUpdate', onSelectionUpdate)

      preview.addEventListener('mousedown', (e) => {
        // Block PM from placing a cursor inside the codeBlock on single click.
        // Default-prevented mousedown short-circuits PM's selection handler.
        e.preventDefault()
      })

      preview.addEventListener('dblclick', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const pos = getPos()
        if (typeof pos !== 'number') return
        editor.chain().focus(pos + 1).run()
      })

      wrapper.appendChild(pre)
      scheduleRender(node)
      updateEditingState()

      return {
        dom: wrapper,
        contentDOM: codeEl,
        update(updatedNode: PMNode) {
          if (updatedNode.type.name !== 'codeBlock') return false
          scheduleRender(updatedNode)
          updateEditingState()
          return true
        },
        ignoreMutation(mutation: MutationRecord | { type: 'selection' }) {
          if (mutation.type === 'selection') return false
          const target = (mutation as MutationRecord).target
          return target !== codeEl && !codeEl.contains(target)
        },
        stopEvent(event: Event) {
          const target = event.target as Node | null
          if (!target) return false
          if (preview.contains(target) || target === preview) return true
          return false
        },
        destroy() {
          destroyed = true
          if (renderTimer) clearTimeout(renderTimer)
          editor.off('selectionUpdate', onSelectionUpdate)
        },
      }
    }
  },
})
