package main

import (
	"errors"
	"net/url"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type WindowService struct{}

// OpenInNewWindow spawns a fresh window that loads the given file on boot.
// The frontend reads ?file= from window.location and opens it as the initial
// tab.
func (s *WindowService) OpenInNewWindow(filePath string) error {
	if filePath == "" {
		return errors.New("file path required")
	}
	spawnWindow("/?file=" + url.QueryEscape(filePath))
	return nil
}

// NewEmptyWindow spawns a fresh window with one Untitled tab.
func (s *WindowService) NewEmptyWindow() error {
	spawnWindow("/")
	return nil
}

// OpenLogsWindow spawns a fresh window dedicated to the Logs UI. The frontend
// boots into logs mode when ?logs=1 is present in the URL. We don't dedupe —
// opening from the menu twice just shows two log windows, which is fine.
func (s *WindowService) OpenLogsWindow() error {
	spawnWindow("/?logs=1")
	return nil
}

// cascadeOffset is the px each new window is offset from the currently
// focused one so they don't perfectly overlap (macOS / Windows convention).
const cascadeOffset = 30

// spawnWindow creates a window pointed at the given URL. If another window
// is already open, the new one cascades from its position so it's visibly
// offset rather than landing exactly on top.
//
// We apply the offset via SetRelativePosition AFTER creation rather than the
// options.X/Y path: on macOS the latter goes through windowSetPosition which
// divides by backingScaleFactor and flips the Y origin (so on Retina + with
// our small offset the window lands near the top-left of the screen). The
// post-creation setter uses windowSetRelativePosition which matches what
// RelativePosition() reads in 1:1 logical pixels.
func spawnWindow(launchURL string) {
	current := application.Get().Window.Current()
	window := application.Get().Window.NewWithOptions(application.WebviewWindowOptions{
		Title:              "MarkdownMD",
		Width:              1000,
		Height:             700,
		MinWidth:           600,
		MinHeight:          400,
		URL:                launchURL,
		UseApplicationMenu: true,
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarDefault,
		},
	})
	if current != nil {
		x, y := current.RelativePosition()
		window.SetRelativePosition(x+cascadeOffset, y+cascadeOffset)
	}
}
