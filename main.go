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

func main() {
	if err := app.Run(app.Options{Assets: assets}); err != nil {
		log.Fatal(err)
	}
}
