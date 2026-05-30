//go:build !pro

package main

import "markdownmd/app"

// applyPro is a no-op in the default OSS build. The real implementation
// lives in pro_on.go behind `//go:build pro` and imports the private
// md-pro module. Keeping the empty stub here means main.go can
// always call applyPro unconditionally — no build-tag gymnastics at the
// call site.
func applyPro(_ *app.Options) {}
