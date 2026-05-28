> **NEXT AGENT — START HERE.** The public-repo seams are done; the `md-pro`
> overlay repo does not exist yet. Your task: **scaffold `md-pro` end-to-end to
> prove the path.** Specifically:
>
> 1. Create the `md-pro` repo with this public repo as a **git submodule**.
> 2. Wire the **vite alias** so `@markdownmd` resolves to the submodule's
>    `frontend/src` (see "Frontend side" below).
> 3. Add a `main.go` with its **own `//go:embed`** of the pro dist that calls
>    `app.Run(app.Options{Assets, ExtraServices, OnReady})`, plus a
>    **`LicenseService`** in `pro/`.
> 4. Ship **one sample gated feature** (a `FeatureModule` registered before
>    `boot()`, gated on the license) to prove the full path compiles, builds,
>    and runs.
>
> The full target layout, code snippets, and invariants are below. Keep this
> public repo untouched and green while you work in `md-pro`.

# Writing pro features (the open-core split)

MarkdownMD is **open-core**. This public repo is the free app and stays fully
OSS and buildable on its own. Paid ("pro") features live in a **separate private
repo, `md-pro`**, that depends on this one and produces the commercial build. No
pro code lives in this tree.

> If you are an agent working in the public repo: nothing here changes how the
> free app behaves. The pro seams below are **dormant** in OSS — no features are
> registered, so every hook is a no-op. Your job is usually to keep the seams
> stable, not to add pro code here.

## Why a second repo (and not build tags)

`package main` is not importable, and we want the free app to compile from this
repo alone. So the reusable app assembly lives in the importable `markdownmd/app`
package, and `md-pro` imports it. We chose this private-overlay model ("Option
A") over a single-repo `ee/`-directory model so pro source is never published.

The honest limitation: **anything shipped to the client can be read.** Open-core
hides pro code from the public repo and lets you enforce a license legally, but a
determined user can decompile the binary or bundled JS. Only **server-backed**
features (AI proxy, sync, cloud) are cryptographically protectable. Pick gated
features accordingly.

## The two injection points

Everything plugs in through exactly two seams. Don't add a third without good
reason.

### 1. Go — `app.Run(app.Options{…})`

`app/app.go` exposes:

```go
type Options struct {
    Assets        fs.FS                              // embedded frontend bundle (required)
    ExtraServices []application.Service              // appended after core services
    OnReady       func(app *application.App)         // runs after core menus, before Run
}
```

- The free `main.go` (repo root) owns `//go:embed all:frontend/dist` and calls
  `app.Run(app.Options{Assets: assets})` — nothing else. The embed lives at the
  root because `go:embed` can't reach `frontend/dist` with `..` from a subpackage.
- `md-pro`'s `main.go` embeds its **own** combined dist and injects pro services
  + an `OnReady` that appends menus and reads the license.

### 2. Frontend — `registerFeature(FeatureModule)`

`frontend/src/app/features.ts` is the registry. A pro feature implements:

```ts
interface FeatureModule {
  id: string                                   // stable, e.g. "pro.ai-assist"
  registerCommands?(ctx: FeatureContext): void // once, after core commands
  attachTab?(tab: Tab, ctx: FeatureContext): void // per tab created
  mount?(ctx: FeatureContext): void            // once, after core UI mounts
}
```

`bootEditor.ts` invokes the hooks at three points (search for `features()`):
after `registerCommands`, inside `attachTabFeatures`, and after the UI mounts.
`FeatureContext` is a **cross-repo API surface** — only ever add fields, never
reorder or remove.

The public API the overlay imports is re-exported from
`frontend/src/index.ts` (resolved via the `@markdownmd` alias, below):
`boot`, `bootEditorWindow`, `registerFeature`, `FeatureModule`,
`FeatureContext`, `commands`, `Command`, `TabManager`, `ExplorerState`, `Tab`.

## Anatomy of a pro feature (lives in `md-pro`)

```ts
// md-pro/frontend/src/features/aiAssist.ts
import { commands, type FeatureModule } from '@markdownmd'
import { hasEntitlement } from '../license' // talks to the pro Go LicenseService

export const aiAssist: FeatureModule = {
  id: 'pro.ai-assist',
  registerCommands() {
    commands.register({
      id: 'pro.ai.rewrite',
      label: 'AI: Rewrite selection',
      handler: async () => {
        if (!(await hasEntitlement('ai'))) return showUpsell('ai')
        // ...call the pro Go service, which proxies your server...
      },
    })
  },
}
```

Two gating styles — pick per feature:

- **Hidden:** don't `commands.register(...)` at all unless licensed. The command
  simply doesn't exist for free users.
- **Discoverable:** always register, then check the entitlement in the handler
  and show an upsell. Better for conversion; the menu item is visible.

Always gate in the **Go `LicenseService`**, not just JS — JS checks are trivially
bypassed. The handler should fail closed if the license can't be verified.

## The `md-pro` repo layout

```
md-pro/
  go.mod                 # module github.com/<you>/md-pro; require markdownmd
  go.work                # or a replace → vendor/md (so Go resolves the submodule)
  main.go                # embeds pro dist, calls app.Run with pro services + OnReady
  pro/                   # Go: LicenseService, server-backed pro services
  vendor/md/             # git submodule of THIS repo (the public app)
  frontend/
    index.html           # <script src="/src/main.ts">
    vite.config.ts       # alias @markdownmd → vendor/md/frontend/src
    src/
      main.ts            # registerFeature(...) ; boot()
      features/…         # pro FeatureModules
      license.ts         # wraps the pro Go LicenseService bindings
```

### Go side (`md-pro/main.go`)

```go
//go:embed all:frontend/dist
var assets embed.FS

func main() {
    lic := pro.NewLicenseService()
    if err := app.Run(app.Options{
        Assets:        assets,
        ExtraServices: []application.Service{application.NewService(lic)},
        OnReady:       func(a *application.App) { pro.AppendMenus(a, lic) },
    }); err != nil {
        log.Fatal(err)
    }
}
```

The free `frontend/dist` is **not** embedded in the pro binary — the pro Vite
build (below) produces a combined dist that this embed points at.

### Frontend side (`md-pro/vite.config.ts`)

```ts
import { defineConfig } from 'vite'
import wails from '@wailsio/runtime/plugins/vite'
import { resolve } from 'node:path'

const pub = resolve(__dirname, 'vendor/md/frontend')
export default defineConfig({
  plugins: [wails('./bindings')],
  resolve: {
    alias: {
      '@markdownmd': resolve(pub, 'src/index.ts'),       // the barrel
      '@markdownmd/': resolve(pub, 'src') + '/',          // deep imports if needed
    },
  },
  build: { target: 'es2022' },
  esbuild: { target: 'es2022' },
})
```

### Frontend entry (`md-pro/frontend/src/main.ts`)

```ts
import { registerFeature, boot } from '@markdownmd'
import { aiAssist } from './features/aiAssist'

registerFeature(aiAssist) // BEFORE boot — bootEditor reads the registry as it wires up
await boot()
```

`boot()` handles the editor-vs-logs window branch, so the pro entry stays a
register-then-boot two-liner.

## Adding a pro feature — checklist

1. In `md-pro`, write a `FeatureModule` (a file under `frontend/src/features/`).
2. If it needs native capability or server access, add a Go service in `pro/`
   and inject it via `ExtraServices`; regenerate bindings in `md-pro`.
3. Gate it on the license (`LicenseService`), choosing hidden vs discoverable.
4. `registerFeature(...)` it in `md-pro/frontend/src/main.ts`.
5. If you need menu items, append them in `OnReady` (Go) — native menus are app
   chrome (see `docs/architecture.md`).
6. Build `md-pro`; the free repo must remain untouched and green.

## Invariants (don't break these)

- **No pro code in the public repo.** If you're editing this tree and reaching
  for a license check, you're in the wrong repo.
- **Keep the public build green and standalone** — `go build .`, `go test ./app`,
  `npm run typecheck`, `npm run build` all pass with zero pro code present.
- **`FeatureContext` / `Options` / the `index.ts` barrel are stable API.** Add,
  don't reorder/remove — `md-pro` pins this repo as a submodule and will break.
- **Every reachable verb still goes through `commands/`** and **markdown stays
  source-of-truth** — pro features obey the same rules as core
  (see `docs/architecture.md`).
- **Regenerate bindings after moving Go packages.** Wails hashes call IDs from
  the package import path; stale bindings silently break IPC.

## Where the seams are in this repo

| Seam | File |
| --- | --- |
| Go options / assembly | `app/app.go` (`Run`, `Options`) |
| Free Go entry + embed | `main.go` |
| Frontend feature registry | `frontend/src/app/features.ts` |
| Hook invocation points | `frontend/src/app/bootEditor.ts` (`features()`) |
| Window boot branch | `frontend/src/app/boot.ts` |
| Public JS API barrel | `frontend/src/index.ts` |
