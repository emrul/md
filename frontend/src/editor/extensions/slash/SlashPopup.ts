import type { SlashItem } from './items'

interface MountProps {
  items: SlashItem[]
  onPick: (item: SlashItem) => void
  clientRect?: (() => DOMRect | null) | null
}

export class SlashPopup {
  private el: HTMLElement
  private items: SlashItem[] = []
  private selectedIndex = 0
  private onPick: (item: SlashItem) => void = () => {}

  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'slash-popup'
    this.el.style.display = 'none'
    document.body.appendChild(this.el)
  }

  mount(props: MountProps): void {
    this.items = props.items
    this.selectedIndex = 0
    this.onPick = props.onPick
    this.render()
    this.position(props.clientRect?.() ?? null)
    this.el.style.display = 'block'
  }

  update(props: MountProps): void {
    this.items = props.items
    if (this.selectedIndex >= this.items.length) {
      this.selectedIndex = Math.max(0, this.items.length - 1)
    }
    this.onPick = props.onPick
    this.render()
    this.position(props.clientRect?.() ?? null)
  }

  unmount(): void {
    this.el.style.display = 'none'
  }

  destroy(): void {
    this.el.remove()
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (this.el.style.display === 'none') return false
    if (this.items.length === 0 && e.key !== 'Escape') return false

    if (e.key === 'ArrowDown') {
      this.selectedIndex = (this.selectedIndex + 1) % this.items.length
      this.render()
      return true
    }
    if (e.key === 'ArrowUp') {
      this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length
      this.render()
      return true
    }
    if (e.key === 'Enter') {
      const item = this.items[this.selectedIndex]
      if (item) this.onPick(item)
      return true
    }
    if (e.key === 'Escape') {
      this.unmount()
      return true
    }
    return false
  }

  private render(): void {
    this.el.replaceChildren()
    if (this.items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'slash-empty'
      empty.textContent = 'No matches'
      this.el.appendChild(empty)
      return
    }
    this.items.forEach((item, i) => {
      const row = document.createElement('div')
      row.className = 'slash-item' + (i === this.selectedIndex ? ' is-selected' : '')

      const label = document.createElement('span')
      label.className = 'slash-label'
      label.textContent = item.label
      row.appendChild(label)

      if (item.hint) {
        const hint = document.createElement('span')
        hint.className = 'slash-hint'
        hint.textContent = item.hint
        row.appendChild(hint)
      }

      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.onPick(item)
      })
      row.addEventListener('mouseenter', () => {
        if (this.selectedIndex !== i) {
          this.selectedIndex = i
          this.render()
        }
      })
      this.el.appendChild(row)
    })
  }

  private position(rect: DOMRect | null): void {
    if (!rect) return
    const popHeight = this.el.offsetHeight || 240
    const top = rect.bottom + 6
    const viewportH = window.innerHeight
    if (top + popHeight > viewportH && rect.top - popHeight - 6 > 0) {
      this.el.style.top = `${rect.top - popHeight - 6}px`
    } else {
      this.el.style.top = `${top}px`
    }
    this.el.style.left = `${rect.left}px`
  }
}
