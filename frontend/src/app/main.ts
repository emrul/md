import { boot } from './boot'
import { registerProFeatures } from '@pro/register'

// Shared entry for both OSS and pro builds. @pro resolves to a no-op stub
// in OSS, and to the md-pro sibling repo's frontend/src/register
// when that repo is present (see vite.config.js). registerProFeatures
// must run BEFORE boot() so bootEditor sees the populated feature
// registry. See docs/pro-features.md.
registerProFeatures()
await boot()
