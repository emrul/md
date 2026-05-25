import CodeBlock from '@tiptap/extension-code-block'
import type { Node as PMNode } from '@tiptap/pm/model'
import './mermaid-codeblock.css'

type MermaidApi = {
  initialize(opts: Record<string, unknown>): void
  render(id: string, code: string, container?: HTMLElement): Promise<{ svg: string }>
}

let _mermaid: MermaidApi | null = null
let mermaidSeq = 0

const mermaidScratch = document.createElement('div')
mermaidScratch.style.cssText = 'position:absolute;visibility:hidden;top:-9999px;left:-9999px'
document.body.appendChild(mermaidScratch)

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
    })
  } catch (err) {
    console.error('[mermaid] load failed:', err)
  }
  return _mermaid
}

export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node }: { node: PMNode }) => {
      const wrapper = document.createElement('div')
      const preview = document.createElement('div')
      const pre = document.createElement('pre')
      const codeEl = document.createElement('code')

      preview.className = 'mermaid-preview'
      pre.appendChild(codeEl)

      if (node.attrs.language) {
        codeEl.className = `language-${node.attrs.language}`
      }

      let renderTimer: ReturnType<typeof setTimeout> | null = null

      const doRender = async (code: string): Promise<void> => {
        const md = await getMermaid()
        if (!md) {
          preview.textContent = '⚠ Mermaid unavailable'
          preview.classList.add('is-error')
          return
        }
        const id = 'mmd' + ++mermaidSeq
        try {
          const { svg } = await md.render(id, code, mermaidScratch)
          preview.innerHTML = svg
          preview.classList.remove('is-error')
        } catch (err) {
          const msg = String(err)
            .replace(/<[^>]*>/g, '')
            .trim()
          preview.textContent = '⚠ Mermaid error: ' + msg
          preview.classList.add('is-error')
          console.error('[mermaid]', err)
        }
      }

      const scheduleRender = (n: PMNode): void => {
        if (n.attrs.language === 'mermaid') {
          if (!wrapper.contains(preview)) wrapper.prepend(preview)
          wrapper.className = 'mermaid-block'
          codeEl.className = 'language-mermaid'
          if (renderTimer) clearTimeout(renderTimer)
          renderTimer = setTimeout(() => void doRender(n.textContent.trim()), 350)
        } else {
          preview.remove()
          wrapper.className = ''
          codeEl.className = n.attrs.language ? `language-${n.attrs.language}` : ''
        }
      }

      wrapper.appendChild(pre)
      scheduleRender(node)

      return {
        dom: wrapper,
        contentDOM: codeEl,
        update(updatedNode: PMNode) {
          if (updatedNode.type.name !== 'codeBlock') return false
          scheduleRender(updatedNode)
          return true
        },
        destroy() {
          if (renderTimer) clearTimeout(renderTimer)
        },
      }
    }
  },
})
