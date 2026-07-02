module markdownmd

go 1.25.0

require (
	github.com/BurntSushi/toml v1.6.0
	github.com/emrul/md-pro v0.0.0
	github.com/wailsapp/wails/v3 v3.0.0-alpha2.111
)

// md-pro is only referenced from pro_on.go behind //go:build pro.
// In the default OSS build it's never compiled, but `go mod tidy` still
// scans the import — so we point it at an in-tree stub. `task setup:pro`
// generates a go.work that overrides this for pro builds.
replace github.com/emrul/md-pro => ./internal/pro-stub

require (
	github.com/adrg/xdg v0.5.3 // indirect
	github.com/coder/websocket v1.8.14 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/wailsapp/wails/webview2 v1.0.27 // indirect
	golang.org/x/mod v0.35.0 // indirect
	golang.org/x/sys v0.43.0 // indirect
)
