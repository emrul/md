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

  // Returns the handler's result so async verbs can be awaited (e.g. save before
  // a follow-up action). Existing `void commands.execute(...)` callers are
  // unaffected — voiding a possible promise is harmless.
  execute(id: string, args?: unknown): void | Promise<void> {
    const cmd = this.commands.get(id)
    if (!cmd) {
      console.warn(`[commands] unknown command: ${id}`)
      return
    }
    return cmd.handler(args)
  }
}

export const commands = new Registry()
