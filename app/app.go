package app

import (
	"fmt"
	"io/fs"
	"os"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// updaterRepo is the GitHub "owner/repo" the self-updater checks for releases.
const updaterRepo = "emrul/md"

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
	// Version is the running app version for the self-updater (compared against
	// GitHub release tags). Set at release-build time via -ldflags; "dev" for
	// local builds, where the updater still initializes but won't match a real
	// release version.
	Version string
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

	setupUpdater(app, opts.Version, logs)

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

// setupUpdater wires the GitHub-backed self-updater. The custom asset matcher
// picks the right *self-updatable* artifact per platform — the default matcher
// (GOOS+GOARCH substring) would grab the wrong file on Windows (the NSIS
// installer instead of the raw .exe) and miss the Linux AppImage. Only the
// AppImage is self-updatable on Linux; .deb/.rpm/.pkg are package-manager
// installs and are intentionally ignored here.
// selfUpdateSupported reports whether in-place self-update applies to this
// build. On Linux only an AppImage can swap itself (the AppImage runtime sets
// $APPIMAGE); deb/rpm/pacman installs are owned by the package manager and must
// update through it. macOS and Windows always self-update.
func selfUpdateSupported() bool {
	if runtime.GOOS == "linux" {
		return os.Getenv("APPIMAGE") != ""
	}
	return true
}

func setupUpdater(app *application.App, version string, logs *LogService) {
	if !selfUpdateSupported() {
		logs.Info("updater", "self-update not applicable for this install (non-AppImage Linux); update via the package manager")
		return
	}
	if version == "" {
		version = "dev"
	}
	gh, err := github.New(github.Config{
		Repository:    updaterRepo,
		ChecksumAsset: "SHA256SUMS",
		AssetMatcher:  matchReleaseAsset,
	})
	if err != nil {
		logs.Warn("updater", "github provider: "+err.Error())
		return
	}
	if err := app.Updater.Init(updater.Config{
		CurrentVersion: version,
		Providers:      []updater.Provider{gh},
	}); err != nil {
		logs.Warn("updater", "init: "+err.Error())
	}
}

// matchReleaseAsset selects the self-updatable asset for the running platform.
// Returns the index into assets, or -1 when none fits.
func matchReleaseAsset(req updater.CheckRequest, assets []github.ReleaseAsset) int {
	wantArch := func(name string) bool {
		switch strings.ToLower(req.Arch) {
		case "amd64":
			return strings.Contains(name, "amd64") || strings.Contains(name, "x86_64") || strings.Contains(name, "x64")
		case "arm64":
			return strings.Contains(name, "arm64") || strings.Contains(name, "aarch64")
		default:
			return strings.Contains(name, strings.ToLower(req.Arch))
		}
	}
	for i, a := range assets {
		name := strings.ToLower(a.Name)
		if !wantArch(name) {
			continue
		}
		switch req.Platform {
		case "darwin":
			if strings.HasSuffix(name, ".zip") && (strings.Contains(name, "darwin") || strings.Contains(name, "macos")) {
				return i
			}
		case "windows":
			// The raw executable, never the NSIS installer.
			if strings.HasSuffix(name, ".exe") && !strings.Contains(name, "installer") {
				return i
			}
		case "linux":
			// AppImage is the only in-place-swappable Linux artifact.
			if strings.HasSuffix(name, ".appimage") {
				return i
			}
		}
	}
	return -1
}
