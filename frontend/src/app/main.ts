import '../styles/tokens.css'
import '../styles/base.css'

// The same SPA boots either the editor or the Logs UI based on a URL flag.
// Dynamic imports keep the unused branch's modules out of the bundle on first
// paint — opening the Logs window doesn't pay for TipTap, and vice versa.
const params = new URLSearchParams(window.location.search)
const isLogsWindow = params.get('logs') === '1'

if (isLogsWindow) {
  // Wipe the editor chrome from index.html synchronously so it never paints
  // before the Logs UI replaces document.body.
  document.body.innerHTML = ''
  const { mount } = await import('../ui/logsWindow')
  await mount()
} else {
  const { bootEditorWindow } = await import('./bootEditor')
  await bootEditorWindow()
}
