// Stub module for github.com/emrul/md-pro. Exists solely so
// `go mod tidy` and IDE tooling can resolve pro_on.go's import without
// network access or a private clone — the real implementation is swapped
// in via go.work when `task setup:pro` is run.
//
// The stub package types satisfy the API surface pro_on.go uses. They
// never execute in the OSS build because pro_on.go is gated by
// `//go:build pro`. They never execute in the pro build either because
// go.work's `use` directive overrides this replace.
module github.com/emrul/md-pro

go 1.25.0

require github.com/wailsapp/wails/v3 v3.0.0-alpha.96
