# Pro features — architecture and contributor guide

> **Audience.** Agents and contributors adding paid features to MarkdownMD.
> Read this top-to-bottom before touching anything tagged `pro`. The
> mental model is short; the rules that follow are load-bearing.

## TL;DR — what to know in one minute

- MarkdownMD is **open-core**. The public repo (`emrul/md`) is the home
  base for both the free OSS build and the commercial pro build.
- The actual pro source lives in a **separate private Go module** at
  `github.com/emrul/md-pro`, kept on disk as a sibling working tree
  (`../md-pro/` relative to `md/`).
- One Go build tag (`pro`) and one env flag (`PRO=1`) flip everything in
  lockstep. With them, the build links in the pro Go module and the pro
  frontend modules; without them, neither is touched.
- The OSS build always works **standalone with zero auth**:
  `git clone <md> && go build` succeeds with no sibling, no network
  reach into the private repo, no submodule magic.

```
~/dev/emrul/
  md/        public OSS app, home base for builds
  md-pro/    private — pro Go module + pro frontend source
```

## Why this layout (briefly)

Two earlier shapes were rejected:

- **Overlay repo containing public as a submodule.** Real source
  privacy, but the day-to-day reverses (you stop working in `md`); CI
  doubles; the public Releases page becomes an empty shell.
- **Pro submodule inside public.** Single conceptual repo, but breaks
  public CI (no token for the private submodule), breaks contributor
  builds (clone gets a missing submodule), and softens the OSS promise.

The **optional Go module** shape solves all three. The trade-off it
explicitly accepts: anything shipped to a client is readable. Source
privacy in git is a development concern, not a runtime protection. Real
protection only exists for **server-backed** features (AI proxy, sync,
cloud). Pick gated features accordingly.

## The two seams

Pro features plug in through exactly two extension points. Don't add a
third without good reason.

### Seam 1 — Go: `app.Options{ ExtraServices, OnReady }`

`app/app.go` exposes:

```go
type Options struct {
    Assets        fs.FS                              // embedded frontend bundle
    ExtraServices []application.Service              // pro Wails services appended after core
    OnReady       func(app *application.App)         // runs after core menus, before Run
    Version       string                             // self-updater version string
}
```

`main.go` always calls `applyPro(&opts)` between constructing the
options and `app.Run`. Two files own that function, and **only one is
compiled per build**:

| File | Build tag | Body |
| --- | --- | --- |
| `pro_off.go` | `!pro` (the default OSS build) | empty `applyPro` |
| `pro_on.go` | `pro` | imports `github.com/emrul/md-pro/pro`, appends `LicenseService` to `ExtraServices`, chains `OnReady` to `pro.AppendMenus` |

The import in `pro_on.go` is resolved differently per build mode:

| Build mode | Where the import resolves |
| --- | --- |
| Default (no `-tags pro`) | `internal/pro-stub/` — a tiny stub Go module with signature-matching `panic()` bodies. Never executed (file is build-tag-excluded). Exists so `go mod tidy` doesn't try to fetch the private module from the network. |
| `-tags pro` | `../md-pro/` — the real private module, via a `use` directive in `go.work`. `task setup:pro` writes the `go.work` file. |

### Seam 2 — Frontend: `registerFeature(FeatureModule)`

`frontend/src/app/features.ts` is the registry. The entry
(`frontend/src/app/main.ts`) always calls `registerProFeatures()` from
`@pro/register` before `boot()`. Vite's alias for `@pro` is conditional
on the `PRO` env var:

| Build mode | Where `@pro` resolves |
| --- | --- |
| `PRO` unset | `frontend/src/pro-stub/register.ts` — `registerProFeatures()` is an empty function. |
| `PRO=1` (set by `task build:pro` / `dev:pro`) | `../../md-pro/frontend/src/` — the real entry that calls `registerFeature(aiAssist)` etc. |

A `FeatureModule` looks like:

```ts
interface FeatureModule {
  id: string                                          // stable, e.g. "pro.ai-assist"
  registerCommands?(ctx: FeatureContext): void        // once, after core commands
  attachTab?(tab: Tab, ctx: FeatureContext): void     // per tab created
  mount?(ctx: FeatureContext): void                   // once, after core UI mounts
}
```

`@markdownmd` is the stable public-API barrel (`frontend/src/index.ts`)
that pro source imports from: `boot`, `registerFeature`, `FeatureModule`,
`FeatureContext`, `commands`, `Command`, `TabManager`, `ExplorerState`,
`Tab`. **Add-only API.** Reordering or removing exports breaks `md-pro`
silently because it pins md as a sibling.

## Adding a new pro feature — step-by-step recipe

You'll usually be touching **only the `md-pro` repo**, with occasional
extension of the stub in `md`. Each feature has a Go side (optional)
and a frontend side (always).

### 1. Add the frontend `FeatureModule` in `md-pro`

File: `~/dev/emrul/md-pro/frontend/src/features/<yourFeature>.ts`

Pattern (adapted from `aiAssist.ts`):

```ts
import { commands, type FeatureModule } from '@markdownmd'
import { hasEntitlement, showUpsell } from '../license'

export const yourFeature: FeatureModule = {
  id: 'pro.your-feature',           // stable id — used for dedupe & logging
  registerCommands() {
    commands.register({
      id: 'pro.your.action',
      label: 'Pro: do the thing',
      keybinding: 'Cmd+Shift+Y',
      handler: async () => {
        if (!(await hasEntitlement('your-feature'))) {
          showUpsell('your-feature')
          return
        }
        // ...real work, almost always calling a pro Go service...
      },
    })
  },
}
```

Pick a gating style per feature:

- **Hidden.** Don't `commands.register(...)` at all unless licensed. The
  verb simply doesn't exist for free users.
- **Discoverable.** Always register, then check entitlement in the
  handler and `showUpsell(...)` if missing. Better for conversion. Used
  by `aiAssist`.

### 2. Register it in `md-pro/frontend/src/register.ts`

```ts
import { registerFeature } from '@markdownmd'
import { aiAssist } from './features/aiAssist'
import { yourFeature } from './features/yourFeature'      // ← add

export function registerProFeatures(): void {
  registerFeature(aiAssist)
  registerFeature(yourFeature)                            // ← add
}
```

That's it for a pure-frontend pro feature. If your feature needs Go
(native capability, server proxy, anything not in the renderer
sandbox), continue:

### 3. (Optional) Add a pro Go service

In `~/dev/emrul/md-pro/pro/<yourservice>.go`:

```go
package pro

type YourService struct {
    lic *LicenseService
}

func NewYourService(lic *LicenseService) *YourService {
    return &YourService{lic: lic}
}

// YourMethod is callable from TypeScript via the generated bindings.
// ALWAYS re-check the license here — JS gating is for UI ergonomics,
// not protection.
func (s *YourService) YourMethod(arg string) (string, error) {
    if !s.lic.HasEntitlement("your-feature") {
        return "", errors.New("not licensed")
    }
    // ...do the work...
    return result, nil
}
```

Wire it in `md-pro/pro/menu.go`'s exports (or wherever the service
constructor is referenced) so `md`'s `pro_on.go` can register it via
`ExtraServices`. If `pro_on.go` already has the wiring you need, you're
done; if you're adding a new top-level service, `pro_on.go` needs a new
`application.NewService(...)` call.

### 4. (If you added a new pro Go service or method) Update the stub

File: `~/dev/emrul/md/internal/pro-stub/pro/stub.go`

The stub MUST mirror the real package's exported signatures, or
`go mod tidy` in OSS will fail. Add stubs with `panic()` bodies:

```go
type YourService struct{}

func NewYourService(_ *LicenseService) *YourService {
    panic("md-pro stub: real module not linked; setup:pro must run before -tags pro builds")
}

func (s *YourService) YourMethod(_ string) (string, error) {
    panic("md-pro stub: real module not linked; setup:pro must run before -tags pro builds")
}
```

The panics are guardrails — these stubs are never compiled into the OSS
binary because `pro_on.go` is build-tag-excluded, and never compiled
into the pro binary because `go.work` redirects to the real module. The
panic just makes a misconfigured build fail loudly instead of silently
returning zero values.

### 5. Regenerate bindings and rebuild

```sh
cd ~/dev/emrul/md
wails3 task setup:pro                                 # idempotent, generates go.work
wails3 generate bindings -f "-tags=pro" -clean=true   # IPC files for pro services
wails3 task build:pro                                 # → bin/MarkdownMD (with pro)
```

Bindings for the new service land under
`frontend/bindings/github.com/emrul/md-pro/pro/<yourservice>.js`. Import
them in `md-pro/frontend/src/<wherever>.ts` via the `@pro-bindings`
alias:

```ts
import { YourMethod } from '@pro-bindings/pro/yourservice.js'
```

### 6. Verify both builds

```sh
cd ~/dev/emrul/md
wails3 task build                                     # OSS — pro absent
wails3 task build:pro                                 # pro present
```

Both should succeed. The OSS binary must not contain any pro symbol
strings; the pro binary must contain your feature's command id when
grep'd from `frontend/dist/`.

## Build / dev reference

```sh
# OSS workflow (fresh clone works as-is)
wails3 task dev                # hot reload, OSS only
wails3 task build              # → bin/MarkdownMD, OSS
wails3 task package            # → bin/MarkdownMD.app etc.

# Pro workflow (requires ../md-pro/ checkout)
wails3 task setup:pro          # one-time per clone; generates go.work
wails3 task dev:pro            # hot reload with pro features
wails3 task build:pro          # → bin/MarkdownMD, with pro features
wails3 task package:pro        # → pro .app / .AppImage / etc.

# Testing the license gate manually
MARKDOWNMD_LICENSE=anything wails3 task dev:pro
# pro.ai.rewrite (Cmd+Shift+A) logs "entitlement OK"
wails3 task dev:pro
# pro.ai.rewrite logs the upsell warning
```

## Common pitfalls (what trips agents up)

- **Forgetting to update the stub when adding pro Go methods.** OSS
  `go mod tidy` will fail with "package pro does not declare
  YourMethod" or similar. Stub signatures MUST mirror the real module.
- **Editing `pro_on.go` to add new imports without updating the stub.**
  Same failure mode as above.
- **Setting `PRO=1` without running `setup:pro` first.** Go side fails
  with "no required module provides...". Frontend side silently falls
  back to the stub. Run `setup:pro` once per clone.
- **Running `task build` while expecting pro features.** `task build`
  is OSS. Pro tasks all have `:pro` suffix.
- **Running `go mod tidy` after editing pro_on.go's import without
  `go.work` present.** Will try to fetch the private module from
  network. Either run `setup:pro` first or temporarily revert
  pro_on.go.
- **Importing from `@pro/...` or `@pro-bindings/...` in core OSS code.**
  Those aliases are for pro source only. Core OSS code uses relative
  imports.
- **Forgetting to regenerate bindings after adding a pro Go method.**
  `wails3 generate bindings -f "-tags=pro" -clean=true`. Old bindings
  silently break IPC.
- **Modifying the public API (`frontend/src/index.ts`,
  `app/app.go:Options`, `FeatureContext`) by reordering or removing.**
  This is stable cross-repo API. Add-only.

## Invariants — don't break these

1. **OSS standalone.** `git clone <md> && go build` works with zero
   auth, zero submodules. The pro module is never fetched.
2. **One binary per platform per release.** The pro build is the
   official distribution; the OSS build is a contributor guarantee
   that "you can build this from open source."
3. **Pro source never lives in `md`.** If you're in this repo and
   reaching for a license check or a `pro.` command handler, you're in
   the wrong repo.
4. **Gate paid work in the Go `LicenseService`**, not just JS. JS
   checks are for UI ergonomics. The handler must fail closed when the
   license can't be verified.
5. **Stable cross-repo API.** `FeatureContext`, `app.Options`, the
   `frontend/src/index.ts` barrel — add-only. Never reorder or remove.
   `md-pro` pins this repo as a sibling and would otherwise silently
   break.
6. **Stub signatures mirror the real module.** Every export in
   `~/dev/emrul/md-pro/pro/*.go` must have a matching declaration in
   `internal/pro-stub/pro/stub.go`. `panic()` bodies are fine.
7. **Every reachable verb still goes through `commands/`** and
   **markdown stays source-of-truth.** Pro features obey the same
   rules as core (see `docs/architecture.md`).
8. **Regenerate bindings after moving Go packages.** Wails hashes call
   IDs from import paths; stale bindings silently break IPC.

## Map of the seams in this repo

| Seam | File |
| --- | --- |
| Go options / assembly | `app/app.go` (`Run`, `Options`) |
| Free entry + embed | `main.go` |
| Pro applyPro stub (OSS) | `pro_off.go` |
| Pro applyPro real (pro) | `pro_on.go` |
| Stub Go module (tidy guard) | `internal/pro-stub/go.mod`, `internal/pro-stub/pro/stub.go` |
| Workspace generation | `Taskfile.yml` → `setup:pro` |
| Frontend feature registry | `frontend/src/app/features.ts` |
| Hook invocation points | `frontend/src/app/bootEditor.ts` (`features()`) |
| Window boot branch | `frontend/src/app/boot.ts` |
| Frontend entry (calls registerProFeatures) | `frontend/src/app/main.ts` |
| OSS frontend stub | `frontend/src/pro-stub/register.ts` |
| Vite aliases | `frontend/vite.config.js` (`@markdownmd`, `@pro`, `@pro-bindings`) |
| TS path aliases | `frontend/tsconfig.json` (`paths`) |
| Public JS API barrel | `frontend/src/index.ts` |
| Pro tasks | `Taskfile.yml` → `setup:pro`, `build:pro`, `dev:pro`, `package:pro` |
