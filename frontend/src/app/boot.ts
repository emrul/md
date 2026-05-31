import '../styles/tokens.css'
import '../styles/base.css'
import { markBootStep } from './bootDiagnostics'

/**
 * Boot the correct window UI based on the URL flag. Shared by the free entry
 * (app/main.ts) and the commercial overlay's entry (md-pro), so both windows
 * pick the same branch. Register any pro features with registerFeature() BEFORE
 * calling this — bootEditorWindow reads the feature registry as it wires up.
 *
 * The same SPA boots either the editor or the Logs UI. Dynamic imports keep the
 * unused branch's modules out of the bundle on first paint — opening the Logs
 * window doesn't pay for TipTap, and vice versa.
 */
export async function boot(): Promise<void> {
  markBootStep('boot: entered')
  const params = new URLSearchParams(window.location.search)
  const isLogsWindow = params.get('logs') === '1'

  if (isLogsWindow) {
    // Wipe the editor chrome from index.html synchronously so it never paints
    // before the Logs UI replaces document.body.
    document.body.innerHTML = ''
    const { mount } = await import('../ui/logsWindow')
    await mount()
  } else {
    markBootStep('boot: importing bootEditor chunk')
    const { bootEditorWindow } = await import('./bootEditor')
    markBootStep('boot: bootEditor chunk imported')
    await bootEditorWindow()
  }
}
