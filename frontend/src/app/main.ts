import { boot } from './boot'

// Free-build entry. The commercial overlay (md-pro) ships its own entry that
// calls registerFeature(...) before boot(); see docs/pro-features.md.
await boot()
