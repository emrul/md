package app

import (
	"fmt"
	"io/fs"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Options configures a MarkdownMD application instance. The free build passes
// only Assets; the commercial overlay injects ExtraServices and OnReady.
type Options struct {
	// Assets is the embedded frontend bundle. Required — the embed lives at the
	// module root so its path can reach frontend/dist without "..".
	Assets fs.FS
	// ExtraServices are appended after the core services so overlay builds can
	// bind their own Wails services (e.g. licensing).
	ExtraServices []application.Service
	// OnReady runs after the app and core menus are constructed, before Run.
	// Overlay builds use it to append menu items and read entitlements.
	OnReady func(app *application.App)
}

// Run constructs and runs the application. It blocks until the app exits.
func Run(opts Options) error {
	prefs, err := NewPreferencesService()
	if err != nil {
		return fmt.Errorf("preferences: %w", err)
	}

	logs := NewLogService()
	workspace := NewWorkspaceService(logs)
	session, err := NewSessionService(logs)
	if err != nil {
		return fmt.Errorf("session: %w", err)
	}
	sessionSvc = session

	services := []application.Service{
		application.NewService(&FileService{}),
		application.NewService(&WindowService{}),
		application.NewService(prefs),
		application.NewService(logs),
		application.NewService(workspace),
		application.NewService(session),
	}
	services = append(services, opts.ExtraServices...)

	app := application.New(application.Options{
		Name:        "MarkdownMD",
		Description: "Markdown editor",
		Services:    services,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(opts.Assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Menu.Set(buildAppMenu(app))
	registerTabContextMenu(app)
	registerExplorerContextMenus(app)
	if opts.OnReady != nil {
		opts.OnReady(app)
	}

	// Persist a clean-shutdown marker on graceful exit so the next launch can
	// tell a crash from a normal quit.
	app.OnShutdown(session.shutdown)

	// Decide what to restore before the loop starts (file I/O only, no window
	// ops) and mark the on-disk session dirty for crash detection. The actual
	// windows are spawned from ApplicationStarted, where window setters can run
	// safely off the main thread.
	session.prepareStartup()
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		startupSpawn()
	})

	return app.Run()
}
