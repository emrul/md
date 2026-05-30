// Package pro is a compile-time stub for github.com/emrul/md-pro/pro.
// It exists so `go mod tidy` resolves pro_on.go's import without needing
// the private repo on disk or network access. The real implementation is
// swapped in at pro-build time via go.work's use directive.
//
// Every symbol exported here MUST match the real package's signature, but
// the bodies are intentionally unreachable — pro_on.go is gated by
// `//go:build pro` so this file is never compiled into the OSS binary,
// and when -tags pro IS set, the workspace points at the real package
// instead of this stub. The panics are a guardrail against an
// accidentally-misconfigured build that hits this code anyway.
package pro

import "github.com/wailsapp/wails/v3/pkg/application"

type LicenseService struct{}

func NewLicenseService() *LicenseService {
	panic("md-pro stub: real module not linked; setup:pro must run before -tags pro builds")
}

func (s *LicenseService) HasEntitlement(_ string) bool { return false }

type LicenseStatus struct {
	Licensed bool   `json:"licensed"`
	Tier     string `json:"tier"`
}

func (s *LicenseService) Status() LicenseStatus { return LicenseStatus{} }

func AppendMenus(_ *application.App, _ *LicenseService) {
	panic("md-pro stub: real module not linked; setup:pro must run before -tags pro builds")
}

// GitHistoryService mirrors github.com/emrul/md-pro/pro.GitHistoryService so OSS
// `go mod tidy` resolves pro_on.go's import. Never compiled into either binary
// (pro_on.go is build-tag-gated; -tags pro swaps in the real module).
type GitHistoryService struct{}

func NewGitHistoryService(_ *LicenseService) *GitHistoryService {
	panic("md-pro stub: real module not linked; setup:pro must run before -tags pro builds")
}

type CommitInfo struct {
	Hash       string `json:"hash"`
	ShortHash  string `json:"shortHash"`
	Subject    string `json:"subject"`
	AuthorName string `json:"authorName"`
	WhenUnixMs int64  `json:"whenUnixMs"`
	PathAtRef  string `json:"pathAtRef"`
}

func (s *GitHistoryService) History(_ string) ([]CommitInfo, error) {
	panic("md-pro stub: real module not linked; setup:pro must run before -tags pro builds")
}

func (s *GitHistoryService) FileAtRef(_, _, _ string) (string, error) {
	panic("md-pro stub: real module not linked; setup:pro must run before -tags pro builds")
}

func (s *GitHistoryService) WorkingStatus(_ string) (bool, error) {
	panic("md-pro stub: real module not linked; setup:pro must run before -tags pro builds")
}
