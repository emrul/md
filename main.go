package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	prefs, err := NewPreferencesService()
	if err != nil {
		log.Fatalf("preferences: %v", err)
	}

	app := application.New(application.Options{
		Name:        "MarkdownMD",
		Description: "Markdown editor",
		Services: []application.Service{
			application.NewService(&FileService{}),
			application.NewService(&WindowService{}),
			application.NewService(prefs),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Menu.Set(buildAppMenu(app))
	registerTabContextMenu(app)

	spawnWindow("/")

	if err = app.Run(); err != nil {
		log.Fatal(err)
	}
}
