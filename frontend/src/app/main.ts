import { boot } from './boot'
import { registerProFeatures } from '@pro/register'
import { installBootDiagnostics, disposeBootDiagnostics, reportBootFailure } from './bootDiagnostics'

// Catch a fatal during boot from the very first line so it surfaces on screen
// (and in the Go log) instead of leaving a blank shell — production builds have
// no inspector to read. See bootDiagnostics.ts.
installBootDiagnostics()

// Shared entry for both OSS and pro builds. @pro resolves to a no-op stub in
// OSS, and to the md-pro sibling repo's frontend/src/register when that repo is
// present (see vite.config.js). registerProFeatures must run BEFORE boot() so
// bootEditor sees the populated feature registry. See ../md-pro/docs/pro-features.md.
registerProFeatures()

// Deliberately NOT a top-level `await boot()`. boot() dynamically imports the
// bootEditor chunk, and Vite hoists its `__vitePreload` helper into THIS entry
// chunk — so bootEditor statically imports the entry back. A top-level await
// here suspends the entry mid-evaluation inside that import cycle, which V8
// (Windows WebView2 / Chrome) deadlocks on while JSC (macOS WebKit) tolerates —
// the app then never mounts on Windows. Starting boot without awaiting lets the
// entry module finish evaluating, so the cycle resolves. See bootDiagnostics.ts.
void boot().then(disposeBootDiagnostics, reportBootFailure)
