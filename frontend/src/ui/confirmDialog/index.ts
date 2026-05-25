import './confirm.css'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'confirm-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'confirm-dialog'
    dialog.setAttribute('role', 'alertdialog')
    dialog.setAttribute('aria-modal', 'true')

    if (opts.title) {
      const title = document.createElement('div')
      title.className = 'confirm-title'
      title.textContent = opts.title
      dialog.appendChild(title)
    }

    const message = document.createElement('div')
    message.className = 'confirm-message'
    message.textContent = opts.message
    dialog.appendChild(message)

    const buttons = document.createElement('div')
    buttons.className = 'confirm-buttons'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'confirm-btn'
    cancelBtn.textContent = opts.cancelLabel ?? 'Cancel'

    const confirmBtn = document.createElement('button')
    confirmBtn.className = 'confirm-btn confirm-btn-primary'
    confirmBtn.textContent = opts.confirmLabel ?? 'OK'

    buttons.append(cancelBtn, confirmBtn)
    dialog.appendChild(buttons)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    const cleanup = (): void => {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cleanup()
        resolve(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        cleanup()
        resolve(true)
      }
    }

    cancelBtn.addEventListener('click', () => {
      cleanup()
      resolve(false)
    })
    confirmBtn.addEventListener('click', () => {
      cleanup()
      resolve(true)
    })
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup()
        resolve(false)
      }
    })

    document.addEventListener('keydown', onKey, true)
    requestAnimationFrame(() => confirmBtn.focus())
  })
}
