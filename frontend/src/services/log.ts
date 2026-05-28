import { LogAppend, LogClear, LogSnapshot } from '../app/ipc'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  timestamp: number
  level: LogLevel
  source: string
  message: string
}

export const log = {
  info: (source: string, message: string): void => {
    void LogAppend('info', source, message)
  },
  warn: (source: string, message: string): void => {
    void LogAppend('warn', source, message)
  },
  error: (source: string, message: string): void => {
    void LogAppend('error', source, message)
  },
  snapshot: async (): Promise<LogEntry[]> => {
    const entries = await LogSnapshot()
    return (entries ?? []) as LogEntry[]
  },
  clear: (): void => {
    void LogClear()
  },
}
