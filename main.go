package main

import (
	"embed"
	"log"

	"markdownmd/app"
)

// The embed lives here at the module root so its path reaches frontend/dist
// without "..". The commercial overlay has its own main with its own embed of a
// dist that bundles the pro frontend modules.
//
//go:embed all:frontend/dist
var assets embed.FS

// currentVersion is the running app version, used by the self-updater to
// compare against GitHub releases. Overridden at release-build time via
// -ldflags "-X main.currentVersion=<tag>"; stays "dev" for local builds.
var currentVersion = "dev"

func main() {
	if err := app.Run(app.Options{Assets: assets, Version: currentVersion}); err != nil {
		log.Fatal(err)
	}
}
