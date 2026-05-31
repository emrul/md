package main

import (
	"embed"
	"log"

	"markdownmd/app"
)

// The embed lives here at the module root so its path reaches frontend/dist
// without "..". With -tags pro, the same dist also contains the pro
// frontend modules (vite's @pro alias resolves into the md-pro
// sibling at build time).
//
//go:embed all:frontend/dist
var assets embed.FS

// currentVersion is the running app version, used by the self-updater to
// compare against GitHub releases. Overridden at release-build time via
// -ldflags "-X main.currentVersion=<tag>"; stays "dev" for local builds.
var currentVersion = "dev"

func main() {
	opts := app.Options{Assets: assets, Version: currentVersion}
	// applyPro is a no-op in the default OSS build; with -tags pro it pulls
	// in the private md-pro module and wires its services + menus.
	// See pro_off.go / pro_on.go and ../md-pro/docs/pro-features.md.
	applyPro(&opts)
	if err := app.Run(opts); err != nil {
		log.Fatal(err)
	}
}
