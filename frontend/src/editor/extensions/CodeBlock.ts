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

// Diagram-type sniff: the first keyword after optional YAML frontmatter
// (--- … ---) and %% directives/comments. Gantt charts are inherently wide, so
// they default to actual-size + horizontal scroll rather than being shrunk.
function isGanttSource(code: string): boolean {
  const lines = code.split('\n')
  let i = 0
  if (lines[i]?.trim() === '---') {
    i++
    while (i < lines.length && lines[i].trim() !== '---') i++
    i++ // past the closing fence
  }
  for (; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === '' || t.startsWith('%%')) continue
    return /^gantt\b/.test(t)
  }
  return false
}

// Intrinsic (unscaled) width of a rendered mermaid SVG, in px. Prefers the
// viewBox / width attribute over getBoundingClientRect, which would report the
// already-shrunk width once max-width:100% has been applied.
function naturalSvgWidth(svg: SVGSVGElement): number {
  const vb = svg.viewBox?.baseVal
  if (vb && vb.width > 0) return vb.width
  const attr = parseFloat(svg.getAttribute('width') || '')
  if (!Number.isNaN(attr) && attr > 0) return attr
  return svg.getBoundingClientRect().width
}

// Four corner brackets pointing out (expand → show at actual size) / in (fit).
// The icon reflects the action available, not the current mode.
const SIZE_ICON_EXPAND =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2H2v4"/><path d="M10 2h4v4"/><path d="M10 14h4v-4"/><path d="M6 14H2v-4"/></svg>'
const SIZE_ICON_FIT =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6h4V2"/><path d="M14 6h-4V2"/><path d="M14 10h-4v4"/><path d="M2 10h4v4"/></svg>'

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

      // Per-diagram fit ↔ actual-size toggle (attached to the block, not the
      // scrolling preview, so it stays pinned in the corner). Hidden until a
      // render proves the diagram is wider than the column.
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'mermaid-size-toggle'
      toggle.setAttribute('contenteditable', 'false')
      toggle.style.display = 'none'
      toggle.addEventListener('mousedown', (e) => {
        // Don't let the click reach PM (selection) or start a text selection.
        e.preventDefault()
        e.stopPropagation()
      })
      toggle.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        userOverrode = true
        sizeMode = sizeMode === 'actual' ? 'fit' : 'actual'
        preview.classList.toggle('is-actual-size', sizeMode === 'actual')
        setToggleAffordance(sizeMode)
      })

      const setCodeLangClass = (lang: string | null | undefined): void => {
        codeEl.className = lang ? `language-${lang} hljs` : 'hljs'
      }

      setCodeLangClass(node.attrs.language)

      let renderTimer: ReturnType<typeof setTimeout> | null = null
      let lastLang: string | null = null
      let lastText: string | null = null
      let destroyed = false
      let isGantt = false
      let sizeMode: 'fit' | 'actual' = 'fit'
      let userOverrode = false // sticky once the user picks a mode for this diagram

      const setToggleAffordance = (mode: 'fit' | 'actual'): void => {
        if (mode === 'actual') {
          toggle.innerHTML = SIZE_ICON_FIT
          toggle.title = 'Fit to width'
          toggle.setAttribute('aria-label', 'Fit diagram to width')
        } else {
          toggle.innerHTML = SIZE_ICON_EXPAND
          toggle.title = 'Show at actual size'
          toggle.setAttribute('aria-label', 'Show diagram at actual size')
        }
      }

      // After a render, decide whether this diagram is wider than the column. If
      // so, expose the toggle and pick a mode (gantt → actual size, others →
      // fit), unless the user has already chosen one. If it fits, there's nothing
      // to toggle — hide the control and stay in fit.
      const applySizing = (): void => {
        const svg = preview.querySelector('svg') as SVGSVGElement | null
        if (!svg) {
          toggle.style.display = 'none'
          preview.classList.remove('is-actual-size')
          return
        }
        const cs = getComputedStyle(preview)
        const avail =
          preview.clientWidth -
          parseFloat(cs.paddingLeft || '0') -
          parseFloat(cs.paddingRight || '0')
        const natural = naturalSvgWidth(svg)
        const wide = natural > 0 && avail > 0 && natural > avail + 1
        toggle.style.display = wide ? '' : 'none'
        const mode: 'fit' | 'actual' = !wide
          ? 'fit'
          : userOverrode
            ? sizeMode
            : isGantt
              ? 'actual'
              : 'fit'
        sizeMode = mode
        preview.classList.toggle('is-actual-size', mode === 'actual')
        setToggleAffordance(mode)
      }

      const doRender = (code: string): void => {
        if (preview.innerHTML === '') preview.textContent = 'Rendering…'
        enqueueMermaidRender(async () => {
          if (destroyed) return
          const md = await getMermaid()
          if (destroyed) return
          if (!md) {
            preview.textContent = '⚠ Mermaid unavailable'
            preview.classList.add('is-error')
            toggle.style.display = 'none'
            return
          }
          const id = 'mmd' + ++mermaidSeq
          try {
            const { svg } = await md.render(id, code, mermaidScratch)
            if (destroyed) return
            preview.innerHTML = svg
            preview.classList.remove('is-error')
            isGantt = isGanttSource(code)
            applySizing()
          } catch (err) {
            if (destroyed) return
            const msg = String(err)
              .replace(/<[^>]*>/g, '')
              .trim()
            preview.textContent = '⚠ Mermaid error: ' + msg
            preview.classList.add('is-error')
            preview.classList.remove('is-actual-size')
            toggle.style.display = 'none'
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
          if (!wrapper.contains(toggle)) wrapper.appendChild(toggle)
          wrapper.className = 'mermaid-block'
          setCodeLangClass('mermaid')
          if (!langChanged && !textChanged) return
          if (renderTimer) clearTimeout(renderTimer)
          const code = text.trim()
          renderTimer = setTimeout(() => doRender(code), 350)
        } else {
          if (langChanged) {
            preview.remove()
            toggle.remove()
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
          if (toggle.contains(target) || target === toggle) return true
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
