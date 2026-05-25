package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	svc := &FileService{}

	app := application.New(application.Options{
		Name:        "MarkdownMD",
		Description: "Markdown editor",
		Services: []application.Service{
			application.NewService(svc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "MarkdownMD",
		Width:  1000,
		Height: 700,
		MinWidth:  600,
		MinHeight: 400,
		URL: "/",
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarDefault,
		},
	})
	svc.window = window

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
