import { Extension } from '@tiptap/core'
import { Suggestion } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { SLASH_ITEMS, type SlashItem } from './items'
import { SlashPopup } from './SlashPopup'
import './slash.css'

const slashKey = new PluginKey('slash-menu')

export const SlashMenu = Extension.create({
  name: 'slashMenu',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => {
          const q = query.toLowerCase()
          if (!q) return SLASH_ITEMS
          return SLASH_ITEMS.filter(
            (item) =>
              item.label.toLowerCase().includes(q) || item.search.some((s) => s.includes(q)),
          )
        },
        command: ({ editor, range, props }) => {
          props.apply(editor, range)
        },
        render: () => {
          let popup: SlashPopup | null = null
          return {
            onStart: (props) => {
              popup = new SlashPopup()
              popup.mount({
                items: props.items,
                onPick: (item) => props.command(item),
                clientRect: props.clientRect,
              })
            },
            onUpdate: (props) => {
              popup?.update({
                items: props.items,
                onPick: (item) => props.command(item),
                clientRect: props.clientRect,
              })
            },
            onKeyDown: ({ event }) => popup?.onKeyDown(event) ?? false,
            onExit: () => {
              popup?.destroy()
              popup = null
            },
          }
        },
      }),
    ]
  },
})
