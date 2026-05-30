// OSS-build fallback for the @pro alias. Vite's resolve.alias in
// vite.config.js points @pro at this stub when the private
// md-pro sibling repo is not checked out next to md. With the
// sibling present, the alias swings to ../../md-pro/frontend/src/
// and the real registerProFeatures (which calls registerFeature for each
// pro module) runs instead.
//
// Calling this no-op from main.ts keeps the call site uniform — no
// conditionals or dynamic imports in the entry, no different bundles per
// build.
export function registerProFeatures(): void {}
