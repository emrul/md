import type { Tab } from '../../app/tab'
import { commands } from '../../commands'
import { getConflictResolver } from '../../services/externalChange'
import './banner.css'

export interface ExternalChangeBannerHandle {
  destroy(): void
}

/**
 * Per-tab "changed on disk" banner — the OSS resolution surface for an external
 * change that landed on a dirty buffer (a clean tab reloads silently, no banner).
 * IntelliJ-style: a thin bar at the top of the tab asking whether to reload.
 *
 * Mounted into the tab's column-flex mount as its first child, so it sits above
 * the editor scroll area and is only visible for the active tab (hidden tabs are
 * `display:none`). Actions dispatch through the command registry; "Compare…"
 * shows only when md-pro has registered a diff resolver.
 */
export function mountExternalChangeBanner(tab: Tab): ExternalChangeBannerHandle {
  const el = document.createElement('div')
  el.className = 'ext-change-banner'
  el.hidden = true

  const msg = document.createElement('span')
  msg.className = 'ext-change-msg'
  msg.textContent = 'This file changed on disk.'

  const actions = document.createElement('div')
  actions.className = 'ext-change-actions'

  const button = (label: string, onClick: () => void, variant = ''): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ext-change-btn' + (variant ? ` ${variant}` : '')
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  const compareBtn = button('Compare…', () => getConflictResolver()?.(tab))
  const reloadBtn = button(
    'Reload from disk',
    () => void commands.execute('file.reloadFromDisk'),
    'primary',
  )
  const overwriteBtn = button('Save mine', () => void commands.execute('file.overwriteDisk'))
  const dismissBtn = button('✕', () => void commands.execute('file.keepWorking'), 'dismiss')
  dismissBtn.title = 'Keep my changes'
  dismissBtn.setAttribute('aria-label', 'Keep my changes')

  actions.append(compareBtn, reloadBtn, overwriteBtn, dismissBtn)
  el.append(msg, actions)
  tab.dom.mount.insertBefore(el, tab.dom.mount.firstChild)

  const refresh = (): void => {
    const changed = tab.externalChange !== null
    el.hidden = !changed
    if (changed) compareBtn.hidden = getConflictResolver() === null
  }
  const off = tab.onChange(refresh)
  refresh()

  return {
    destroy(): void {
      off()
      el.remove()
    },
  }
}
