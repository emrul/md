/**
 * Surface fatal boot failures visibly instead of leaving a blank shell.
 *
 * Almost everything the user sees — toolbar, file explorer, tab strip, editor —
 * is mounted by JS in bootEditorWindow(). The status bar in index.html is the
 * only static chrome. So an exception (or unhandled rejection) during boot used
 * to leave just that static bar with no clue why, and production builds disable
 * the WebView inspector, so there was no console to read.
 *
 * This renders the error on screen and mirrors it to the Go log, making a
 * packaged build self-diagnosing — notably for platform-specific failures that
 * don't reproduce on the developer's machine.
 *
 * Scope is boot only: disposeBootDiagnostics() removes the global listeners once
 * boot succeeds, so ordinary runtime errors later on don't trigger the banner.
 *
 * A watchdog also catches the *silent* failure mode — boot stalling with no
 * exception to listen for — and reports the last boot milestone reached.
 */

// If boot hasn't finished within this long, assume it has stalled and say so.
const BOOT_WATCHDOG_MS = 10000

let reported = false
let watchdog: ReturnType<typeof setTimeout> | null = null

// Last boot milestone reached (see markBootStep). Pinpoints where boot stalled.
let lastStep = '(boot not entered)'

declare global {
  // eslint-disable-next-line no-var
  var __mdBootStep: ((step: string) => void) | undefined
}

/** Record the latest boot milestone; surfaced in the stall banner. */
export function markBootStep(step: string): void {
  lastStep = step
}

// Expose markBootStep as a global so the dynamically-imported bootEditor chunk
// can report progress WITHOUT a static `import` back into the entry chunk — that
// import would re-create the entry↔bootEditor cycle that the no-top-level-await
// change in main.ts exists to keep deadlock-free on V8. See main.ts.
globalThis.__mdBootStep = markBootStep

const onError = (ev: ErrorEvent): void => {
  const err = ev.error ?? (ev.message ? ev.message : null)
  if (err) reportBootFailure(err)
}

const onRejection = (ev: PromiseRejectionEvent): void => {
  reportBootFailure(ev.reason ?? 'Unhandled promise rejection')
}

/** Start catching uncaught errors / rejections + arm the stall watchdog. */
export function installBootDiagnostics(): void {
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  watchdog = setTimeout(() => {
    reportBootFailure(
      `Boot did not finish within ${BOOT_WATCHDOG_MS / 1000}s — the frontend stalled.\n\n` +
        `Last boot step: ${lastStep}`,
    )
  }, BOOT_WATCHDOG_MS)
}

/** Stop catching once the app has booted cleanly. */
export function disposeBootDiagnostics(): void {
  window.removeEventListener('error', onError)
  window.removeEventListener('unhandledrejection', onRejection)
  if (watchdog !== null) {
    clearTimeout(watchdog)
    watchdog = null
  }
}

/** Render a fatal-boot banner (first failure only) and mirror it to the Go log. */
export function reportBootFailure(err: unknown): void {
  if (reported) return
  reported = true
  if (watchdog !== null) {
    clearTimeout(watchdog)
    watchdog = null
  }

  const detail = describe(err)
  console.error('[boot] fatal', err)
  renderBanner(detail)
  void mirrorToGoLog(detail)
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}\n${err.stack ?? ''}`.trim()
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function renderBanner(detail: string): void {
  const el = document.createElement('pre')
  el.setAttribute('data-boot-error', '')
  // Inline styles only — the stylesheet may not have loaded, and we must not
  // depend on any app CSS being applied.
  el.style.cssText = [
    'position:fixed',
    'inset:0 0 auto 0',
    'z-index:2147483647',
    'margin:0',
    'padding:12px 16px',
    'max-height:60vh',
    'overflow:auto',
    'background:#7f1d1d',
    'color:#fff',
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    'white-space:pre-wrap',
    'word-break:break-word',
    'border-bottom:2px solid #fca5a5',
  ].join(';')
  el.textContent = `MarkdownMD failed to start.\n\n${detail}`

  const attach = (): void => {
    document.body?.appendChild(el)
  }
  if (document.body) attach()
  else document.addEventListener('DOMContentLoaded', attach, { once: true })
}

async function mirrorToGoLog(detail: string): Promise<void> {
  try {
    const { log } = await import('../services/log')
    log.error('boot', detail)
  } catch {
    /* logging is best-effort — never let it mask the original failure */
  }
}
