import { commands } from './registry'

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

function keyName(e: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5)
  return e.key.length === 1 ? e.key.toUpperCase() : e.key
}

function eventCombo(e: KeyboardEvent): string | null {
  if (!e.metaKey && !e.ctrlKey) return null
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push(isMac ? 'Cmd' : 'Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(keyName(e))
  return parts.join('+')
}

export function installKeymap(): void {
  // Capture phase, and stopPropagation on a match, so a registered combo never
  // also reaches ProseMirror. Several of our verbs share a chord with a built-in
  // TipTap shortcut (Bold→Mod-b, Italic→Mod-i, lists/blockquote/heading, …).
  // PM handles the key on the editor element (bubble phase) and calls
  // preventDefault but NOT stopPropagation, so the event used to bubble on to
  // this document listener and toggle the same verb a SECOND time — a net no-op
  // wherever PM's command actually applies (e.g. bold inside a table cell). It
  // only "worked" in hybrid source blocks because PM's mark command is a no-op
  // there (marks disallowed in the code-spec block), leaving us the sole
  // handler. Intercepting first makes the command registry the single dispatch.
  document.addEventListener(
    'keydown',
    (e) => {
      const combo = eventCombo(e)
      if (!combo) return
      for (const cmd of commands.list()) {
        if (cmd.keybinding === combo) {
          e.preventDefault()
          e.stopPropagation()
          void cmd.handler()
          return
        }
      }
    },
    true,
  )
}
