import type { Editor } from '@tiptap/core'
import type { ViewController } from './viewMode'

type Listener = () => void

export interface LinkController {
  requestLink(): boolean
}

export class Workspace {
  filePath: string | null = null
  modified = false
  linkController: LinkController | null = null
  viewController: ViewController | null = null
  private listeners: Set<Listener> = new Set()

  constructor(public readonly editor: Editor) {}

  getCurrentMarkdown(): string {
    return this.viewController?.getCurrentMarkdown() ?? ''
  }

  loadMarkdown(text: string): void {
    this.viewController?.loadMarkdown(text)
  }

  fileName(): string {
    return this.filePath ? this.filePath.replace(/.*[/\\]/, '') : 'Untitled.md'
  }

  setFilePath(path: string | null): void {
    this.filePath = path
    this.notify()
  }

  setModified(value: boolean): void {
    this.modified = value
    this.notify()
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  notify(): void {
    for (const fn of this.listeners) fn()
  }
}
