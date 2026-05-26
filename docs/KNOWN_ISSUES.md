# Known Issues

## macOS app icon does not update from `appicon.png` alone

**Root cause:** Wails 3's Mac flow puts a compiled Asset Catalog (`build/darwin/Assets.car`) into the bundle, generated from `build/appicon.icon/wails_icon_vector.svg`. With `CFBundleIconName=appicon` set in `Info.plist`, macOS reads the icon from that catalog before falling back to `icons.icns`. I'd updated `appicon.png` (which feeds `icons.icns`), but the `.icon` source — and the bundled `Assets.car` — still held the old Wails W mark.

**Current workaround:** Removed `build/appicon.icon/` and `build/darwin/Assets.car`; updated `build/Taskfile.yml`'s `generate:icons` task to drop `-iconcomposerinput`/`-macassetdir`. macOS now falls back to `icons.icns` from `appicon.png`. After changes, delete any stale `bin/MarkdownMD.dev.app` / `bin/MarkdownMD` before re-running `wails3 dev`, and `killall Dock` if the Dock still caches the old icon.

**Tradeoff:** No macOS 15+ icon-composer variants (light/dark/tinted) until a proper foreground-only SVG is authored and `appicon.icon/icon.json` is restored.

## Caret jumps from offset 0 of a heading after a few hundred ms

**Symptom:** Placing the cursor at offset 0 of a heading line (e.g. `## title`) — visually just after the muted `## ` markers — sees the caret drift to offset 1 (between `t` and `i`) after a short delay, making the `#`-at-start cycle unreliable.

**Root cause:** The `## ` markers are ProseMirror widget decorations, not real text. Position 1 in the heading content is the cursor slot immediately after the widget DOM. WebKit's caret renderer renormalizes that boundary toward the next real text node on a later paint cycle; PM's DOM observer then syncs PM's selection to match. Tried: `BubbleMenu` `appendTo: body` + `updateDelay: 0` + `duration: 0`, removing padding/margin on the active-marker styling, varying widget keys per state — none fixed it.

**Workaround:** `⌘]` / `⌘[` cycle heading level forward/backward from any cursor position in the heading. `⌘⌥1/2/3` set H1/H2/H3 directly.

**Real fix (deferred):** Replace the widget-decoration approach for block prefixes with a heading NodeView that renders `# ` as contenteditable-false sibling DOM inside a proper heading element. Substantial rewrite — punt until it materially blocks usage.
