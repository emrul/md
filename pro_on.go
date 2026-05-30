//go:build pro

package main

import (
	"github.com/emrul/md-pro/pro"
	"github.com/wailsapp/wails/v3/pkg/application"
	"markdownmd/app"
)

// applyPro wires the private md-pro module into the public app's
// Options. It runs only in builds tagged `pro`; the OSS build uses the
// no-op in pro_off.go and never references this file.
//
// The import of github.com/emrul/md-pro is the sole reason that
// module is reachable from md. `go mod tidy` without `-tags pro` will not
// see this import, so md's go.mod stays clean for public users. The
// module is resolved at -tags pro build time via a local go.work (created
// by `task setup:pro`) or, in CI, via a token-authenticated fetch.
func applyPro(opts *app.Options) {
	lic := pro.NewLicenseService()
	opts.ExtraServices = append(opts.ExtraServices, application.NewService(lic))
	// Change History feature: a git-backed service the frontend calls via bindings.
	gitHist := pro.NewGitHistoryService(lic)
	opts.ExtraServices = append(opts.ExtraServices, application.NewService(gitHist))
	// Chain OnReady so that if md ever wires its own ready hook later, we
	// don't silently overwrite it. Today md's main.go sets none.
	prev := opts.OnReady
	opts.OnReady = func(a *application.App) {
		if prev != nil {
			prev(a)
		}
		pro.AppendMenus(a, lic)
	}
}
