export interface Command {
  id: string
  label: string
  keybinding?: string
  handler: () => void
}

class Registry {
  private commands = new Map<string, Command>()

  register(cmd: Command): void {
    this.commands.set(cmd.id, cmd)
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)
  }

  list(): Command[] {
    return Array.from(this.commands.values())
  }

  execute(id: string): void {
    const cmd = this.commands.get(id)
    if (!cmd) {
      console.warn(`[commands] unknown command: ${id}`)
      return
    }
    void cmd.handler()
  }
}

export const commands = new Registry()
