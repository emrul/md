import './confirm.css'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
}

interface PromptOptions {
  title: string
  label: string
  value?: string
  placeholder?: string
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

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const overlay = document.createElement('div')
    overlay.className = 'confirm-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'confirm-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')

    const title = document.createElement('div')
    title.className = 'confirm-title'
    title.textContent = opts.title
    dialog.appendChild(title)

    const field = document.createElement('label')
    field.className = 'confirm-field'
    const label = document.createElement('span')
    label.className = 'confirm-field-label'
    label.textContent = opts.label
    const input = document.createElement('input')
    const inputID = `confirm-input-${Math.random().toString(36).slice(2)}`
    input.className = 'confirm-input'
    input.id = inputID
    input.name = 'prompt-value'
    input.type = 'url'
    input.value = opts.value ?? ''
    input.placeholder = opts.placeholder ?? ''
    input.autocomplete = 'off'
    field.htmlFor = inputID
    field.append(label, input)
    dialog.appendChild(field)

    const buttons = document.createElement('div')
    buttons.className = 'confirm-buttons'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'confirm-btn'
    cancelBtn.textContent = opts.cancelLabel ?? 'Cancel'

    const confirmBtn = document.createElement('button')
    confirmBtn.className = 'confirm-btn confirm-btn-primary'
    confirmBtn.textContent = opts.confirmLabel ?? 'Insert'

    buttons.append(cancelBtn, confirmBtn)
    dialog.appendChild(buttons)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    const cleanup = (): void => {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
    }

    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        finish(input.value.trim())
      }
    }

    cancelBtn.addEventListener('click', () => finish(null))
    confirmBtn.addEventListener('click', () => finish(input.value.trim()))
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null)
    })

    document.addEventListener('keydown', onKey, true)
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  })
}
