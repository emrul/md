import './styles.css'
import { Events, Window } from '@wailsio/runtime'
import { log, type LogEntry } from '../../services/log'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d
    .getMilliseconds()
    .toString()
    .padStart(3, '0')}`
}

function renderRow(entry: LogEntry): HTMLElement {
  const row = document.createElement('div')
  row.className = `log-row log-row-${entry.level}`

  const time = document.createElement('span')
  time.className = 'log-time'
  time.textContent = formatTime(entry.timestamp)

  const level = document.createElement('span')
  level.className = 'log-level'
  level.textContent = entry.level

  const source = document.createElement('span')
  source.className = 'log-source'
  source.textContent = entry.source

  const message = document.createElement('span')
  message.className = 'log-message'
  message.textContent = entry.message

  row.append(time, level, source, message)
  return row
}

const AUTOSCROLL_THRESHOLD_PX = 32

export async function mount(): Promise<void> {
  await Window.SetTitle('Logs')

  document.body.innerHTML = `
    <div class="logs-app">
      <header class="logs-header">
        <span class="logs-title">Logs</span>
        <button class="logs-clear" type="button">Clear</button>
      </header>
      <div class="logs-list" id="logs-list"></div>
    </div>
  `

  const list = document.getElementById('logs-list') as HTMLDivElement
  const clearBtn = document.querySelector('.logs-clear') as HTMLButtonElement

  function isAtBottom(): boolean {
    return list.scrollHeight - list.scrollTop - list.clientHeight < AUTOSCROLL_THRESHOLD_PX
  }

  function append(entry: LogEntry): void {
    const stick = isAtBottom()
    list.appendChild(renderRow(entry))
    if (stick) list.scrollTop = list.scrollHeight
  }

  // Initial render from the buffer snapshot.
  const initial = await log.snapshot()
  for (const e of initial) list.appendChild(renderRow(e))
  list.scrollTop = list.scrollHeight

  // Catch up incrementally.
  Events.On('log:appended', (ev) => {
    const data = ev.data as LogEntry | undefined
    if (!data) return
    append(data)
  })
  Events.On('log:cleared', () => {
    list.innerHTML = ''
  })

  clearBtn.addEventListener('click', () => log.clear())
}
