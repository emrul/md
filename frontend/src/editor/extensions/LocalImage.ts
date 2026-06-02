import Image, { type ImageOptions } from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { resolvedImageSrc } from '../imagePaths'

export interface LocalImageOptions extends ImageOptions {
  getSourcePath: () => string | null
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

function escapeDestination(value: string): string {
  if (/\s|[()]/.test(value)) return `<${value.replace(/>/g, '%3E')}>`
  return value.replace(/[()]/g, '\\$&')
}

function serializeImage(node: PMNode): string {
  const alt = escapeText((node.attrs.alt as string | null) ?? '')
  const src = escapeDestination((node.attrs.src as string | null) ?? '')
  const title = node.attrs.title as string | null
  const suffix = title ? ` "${title.replace(/"/g, '\\"')}"` : ''
  return `![${alt}](${src}${suffix})`
}

export const LocalImage = Image.extend<LocalImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      getSourcePath: () => null,
    }
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes }
    const displaySrc = resolvedImageSrc(
      attrs.src as string | undefined,
      this.options.getSourcePath(),
    )
    if (displaySrc) attrs.src = displaySrc
    return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)]
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(
          state: { write: (s: string) => void; closeBlock: (n: PMNode) => void },
          node: PMNode,
        ) {
          state.write(serializeImage(node))
          if (node.isBlock) state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})
