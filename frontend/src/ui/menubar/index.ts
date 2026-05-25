import { commands } from '../../commands/registry'
import './menubar.css'

const menuItemBindings: Record<string, string> = {
  'mi-new': 'file.new',
  'mi-open': 'file.open',
  'mi-save': 'file.save',
  'mi-saveas': 'file.saveAs',
  'mi-bold': 'format.bold',
  'mi-italic': 'format.italic',
  'mi-strike': 'format.strike',
  'mi-code': 'format.code',
  'mi-codeblock': 'format.codeBlock',
  'mi-link': 'insert.link',
}

export function mountMenubar(): void {
  let openMenu: HTMLElement | null = null
  let menuOpen = false

  const activate = (menuEl: HTMLElement): void => {
    if (openMenu) openMenu.classList.remove('open')
    menuEl.classList.add('open')
    openMenu = menuEl
    menuOpen = true
  }

  const close = (): void => {
    if (openMenu) openMenu.classList.remove('open')
    openMenu = null
    menuOpen = false
  }

  document.querySelectorAll<HTMLElement>('.menu').forEach((menu) => {
    const label = menu.querySelector<HTMLElement>('.menu-label')
    if (!label) return

    label.addEventListener('click', (e) => {
      e.stopPropagation()
      if (menuOpen && openMenu === menu) {
        close()
      } else {
        activate(menu)
      }
    })

    label.addEventListener('mouseenter', () => {
      if (menuOpen && openMenu !== menu) activate(menu)
    })
  })

  document.querySelectorAll<HTMLElement>('.menu-item').forEach((item) => {
    const cmdId = menuItemBindings[item.id]
    if (cmdId) {
      item.addEventListener('click', () => {
        close()
        commands.execute(cmdId)
      })
    } else {
      item.addEventListener('click', () => close())
    }
  })

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    if (!target?.closest('.menu-bar')) close()
  })
}
