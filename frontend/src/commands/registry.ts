export interface Command<A = unknown> {
  id: string
  label: string
  keybinding?: string
  handler: (args?: A) => void | Promise<void>
}

class Registry {
  private commands = new Map<string, Command>()

  register<A = unknown>(cmd: Command<A>): void {
    this.commands.set(cmd.id, cmd as Command)
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)
  }

  list(): Command[] {
    return Array.from(this.commands.values())
  }

  execute(id: string, args?: unknown): void {
    const cmd = this.commands.get(id)
    if (!cmd) {
      console.warn(`[commands] unknown command: ${id}`)
      return
    }
    void cmd.handler(args)
  }
}

export const commands = new Registry()
