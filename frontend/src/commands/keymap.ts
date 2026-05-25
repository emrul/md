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
  document.addEventListener('keydown', (e) => {
    const combo = eventCombo(e)
    if (!combo) return
    for (const cmd of commands.list()) {
      if (cmd.keybinding === combo) {
        e.preventDefault()
        void cmd.handler()
        return
      }
    }
  })
}
