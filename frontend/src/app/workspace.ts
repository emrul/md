import type { Editor } from '@tiptap/core'

type Listener = () => void

export interface LinkController {
  requestLink(): boolean
}

export class Workspace {
  filePath: string | null = null
  modified = false
  linkController: LinkController | null = null
  private listeners: Set<Listener> = new Set()

  constructor(public readonly editor: Editor) {}

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
