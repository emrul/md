package app

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// sessionSvc is the process-wide session store, set in main before app.Run.
// Session-tracked window spawns register here so geometry + lifecycle feed
// restore. nil-safe: the helpers no-op when it isn't wired.
var sessionSvc *SessionService

var winSeq uint64

// firstLaunch is true when no preferences file existed at startup (fresh
// install). Set in Run from the PreferencesService; read by startupSpawn to open
// the bundled Examples instead of a blank window on the very first launch.
var firstLaunch bool

// restorePromptPending is true only while the crash-recovery prompt is on screen
// and the window(s) it spawns don't exist yet. During that gap there are zero
// windows: the button callbacks run on the main thread, so the spawn (window
// setters InvokeSync to the main thread) must happen on a goroutine, which leaves
// a brief zero-window instant when the dialog closes. macOS's "terminate after
// last window closed" would quit the app in that instant — before the spawn lands
// — which is the intermittent "restore prompt then immediately exits" bug.
// appShouldQuit vetoes termination while this is set.
var restorePromptPending atomic.Bool

// openFileRoutingReady flips once startup has spawned its initial editor
// window(s). Launch Services can deliver open-file events before that point, so
// early paths are queued and then converted into the initial window URL.
var openFileRoutingReady atomic.Bool

var queuedOpenFilesMu sync.Mutex
var queuedOpenFiles []string

var readyEditorWindowsMu sync.Mutex
var readyEditorWindows = map[string]bool{}

const openFilesEventName = "file:openPaths"

// appShouldQuit backs application.Options.ShouldQuit. It only blocks quitting
// during the restore-prompt gap above; in all normal use it returns true, so ⌘Q
// and closing the last window quit as usual.
func appShouldQuit() bool {
	return !restorePromptPending.Load()
}

// newWindowID mints a stable, process-unique window identifier used both as the
// Wails window Name and the session key. Unlike Wails' default "window-N" name,
// this is suitable for persisting across restarts.
func newWindowID() string {
	return fmt.Sprintf("win-%d-%d", time.Now().UnixNano(), atomic.AddUint64(&winSeq, 1))
}

type WindowService struct{}

// OpenInNewWindow spawns a fresh window that loads the given file on boot.
// The frontend reads ?file= from window.location and opens it as the initial
// tab.
func (s *WindowService) OpenInNewWindow(filePath string) error {
	if filePath == "" {
		return errors.New("file path required")
	}
	spawnEditorWindow(filesLaunchURL([]string{filePath}))
	return nil
}

// NewEmptyWindow spawns a fresh window with one Untitled tab.
func (s *WindowService) NewEmptyWindow() error {
	spawnEditorWindow("/")
	return nil
}

// OpenLogsWindow spawns a fresh window dedicated to the Logs UI. The frontend
// boots into logs mode when ?logs=1 is present in the URL. We don't dedupe —
// opening from the menu twice just shows two log windows, which is fine. The
// Logs window does not participate in session restore.
func (s *WindowService) OpenLogsWindow() error {
	spawnPlainWindow("/?logs=1")
	return nil
}

// MarkEditorReady is called by the frontend once its file-open event listener
// and initial tabs are installed. Only then is it safe for native open-file
// events to target this window.
func (s *WindowService) MarkEditorReady(windowName string) error {
	if windowName == "" {
		return errors.New("window name required")
	}
	window, ok := application.Get().Window.GetByName(windowName)
	if !ok {
		return errors.New("window not found")
	}
	markEditorWindowReady(window)
	return nil
}

// cascadeOffset is the px each new window is offset from the currently
// focused one so they don't perfectly overlap (macOS / Windows convention).
const cascadeOffset = 30

const (
	defaultWindowWidth  = 1000
	defaultWindowHeight = 700
)

func newWindowOptions(name, launchURL string, width, height int) application.WebviewWindowOptions {
	return application.WebviewWindowOptions{
		Name:               name,
		Title:              "MarkdownMD",
		Width:              width,
		Height:             height,
		MinWidth:           600,
		MinHeight:          400,
		URL:                launchURL,
		UseApplicationMenu: true,
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarDefault,
		},
	}
}

// spawnPlainWindow creates a window that does NOT participate in session
// restore (the Logs window). Cascades from the current window so it lands
// visibly offset rather than exactly on top.
//
// We apply the offset via SetRelativePosition AFTER creation rather than the
// options.X/Y path: on macOS the latter goes through windowSetPosition which
// divides by backingScaleFactor and flips the Y origin (so on Retina + with
// our small offset the window lands near the top-left of the screen). The
// post-creation setter uses windowSetRelativePosition which matches what
// RelativePosition() reads in 1:1 logical pixels.
func spawnPlainWindow(launchURL string) {
	app := application.Get()
	current := app.Window.Current()
	window := app.Window.NewWithOptions(newWindowOptions("", launchURL, defaultWindowWidth, defaultWindowHeight))
	if current != nil {
		x, y := current.RelativePosition()
		window.SetRelativePosition(x+cascadeOffset, y+cascadeOffset)
	}
}

// spawnEditorWindow creates a fresh, session-tracked editor window, cascaded
// from the current window. Used by File > New Window and Open in New Window.
func spawnEditorWindow(launchURL string) {
	app := application.Get()
	id := newWindowID()
	current := app.Window.Current()
	window := app.Window.NewWithOptions(newWindowOptions(id, launchURL, defaultWindowWidth, defaultWindowHeight))
	x, y := 0, 0
	if current != nil {
		cx, cy := current.RelativePosition()
		x, y = cx+cascadeOffset, cy+cascadeOffset
		window.SetRelativePosition(x, y)
	}
	registerSessionWindow(window, id, x, y, defaultWindowWidth, defaultWindowHeight, false)
}

// spawnExamplesWindow opens a session-tracked editor window pre-loaded with the
// bundled onboarding docs as read-only tabs (the frontend reads ?examples=1).
// It won't survive restore — the example tabs have no file paths, so the window
// records no restorable tabs.
func spawnExamplesWindow() {
	spawnEditorWindow("/?examples=1")
}

func filesLaunchURL(paths []string) string {
	values := url.Values{}
	for _, path := range paths {
		if path == "" {
			continue
		}
		values.Add("file", path)
	}
	if len(values) == 0 {
		return "/"
	}
	return "/?" + values.Encode()
}

func handleExternalOpenFile(filePath string) {
	if filePath == "" {
		return
	}
	if !openFileRoutingReady.Load() {
		queueOpenFiles([]string{filePath})
		return
	}
	if !routeOpenFilesToEditor([]string{filePath}) {
		if hasEditorWindow() {
			queueOpenFiles([]string{filePath})
			return
		}
		spawnEditorWindow(filesLaunchURL([]string{filePath}))
	}
}

func queueOpenFiles(paths []string) {
	queuedOpenFilesMu.Lock()
	defer queuedOpenFilesMu.Unlock()
	for _, path := range paths {
		if path != "" {
			queuedOpenFiles = append(queuedOpenFiles, path)
		}
	}
}

func takeQueuedOpenFiles() []string {
	queuedOpenFilesMu.Lock()
	defer queuedOpenFilesMu.Unlock()
	if len(queuedOpenFiles) == 0 {
		return nil
	}
	paths := append([]string(nil), queuedOpenFiles...)
	queuedOpenFiles = nil
	return paths
}

func spawnQueuedOpenFiles() bool {
	paths := takeQueuedOpenFiles()
	if len(paths) == 0 {
		return false
	}
	spawnEditorWindow(filesLaunchURL(paths))
	return true
}

func flushQueuedOpenFiles() {
	paths := takeQueuedOpenFiles()
	if len(paths) == 0 {
		return
	}
	if !routeOpenFilesToEditor(paths) {
		if hasEditorWindow() {
			queueOpenFiles(paths)
			return
		}
		spawnEditorWindow(filesLaunchURL(paths))
	}
}

func routeOpenFilesToEditor(paths []string) bool {
	target := preferredEditorWindow()
	if target == nil {
		return false
	}
	target.Show()
	target.Focus()
	target.EmitEvent(openFilesEventName, paths)
	return true
}

func preferredEditorWindow() application.Window {
	app := application.Get()
	if current := app.Window.Current(); isReadyEditorWindow(current) {
		return current
	}

	var fallback application.Window
	for _, window := range app.Window.GetAll() {
		if !isReadyEditorWindow(window) {
			continue
		}
		if window.IsFocused() {
			return window
		}
		if fallback == nil || window.IsVisible() {
			fallback = window
		}
	}
	return fallback
}

func hasEditorWindow() bool {
	for _, window := range application.Get().Window.GetAll() {
		if isEditorWindow(window) {
			return true
		}
	}
	return false
}

func isEditorWindow(window application.Window) bool {
	return window != nil && strings.HasPrefix(window.Name(), "win-")
}

func isReadyEditorWindow(window application.Window) bool {
	if !isEditorWindow(window) {
		return false
	}
	readyEditorWindowsMu.Lock()
	defer readyEditorWindowsMu.Unlock()
	return readyEditorWindows[window.Name()]
}

func markEditorWindowReady(window application.Window) {
	if !isEditorWindow(window) {
		return
	}
	readyEditorWindowsMu.Lock()
	readyEditorWindows[window.Name()] = true
	readyEditorWindowsMu.Unlock()
	flushQueuedOpenFiles()
}

func markEditorWindowClosed(name string) {
	readyEditorWindowsMu.Lock()
	delete(readyEditorWindows, name)
	readyEditorWindowsMu.Unlock()
}

// openExamplesWindow is the Help → Examples menu callback.
func openExamplesWindow(*application.Context) {
	spawnExamplesWindow()
}

// spawnRestoreWindow recreates a window from a saved session record. The
// frontend reads ?restore=<id> and pulls its tabs + explorer state from the
// SessionService. Must run off the main thread (window setters dispatch to it).
func spawnRestoreWindow(w WindowSession) {
	app := application.Get()
	width, height := w.Width, w.Height
	if width <= 0 {
		width = defaultWindowWidth
	}
	if height <= 0 {
		height = defaultWindowHeight
	}
	window := app.Window.NewWithOptions(newWindowOptions(w.ID, "/?restore="+url.QueryEscape(w.ID), width, height))
	window.SetRelativePosition(w.X, w.Y)
	if w.Maximised {
		window.Maximise()
	}
	registerSessionWindow(window, w.ID, w.X, w.Y, width, height, w.Maximised)
}

// registerSessionWindow records the window in the session store and wires the
// lifecycle hooks that keep its geometry fresh and drop it on intentional
// close. The move/resize hooks only schedule a persist; the geometry itself is
// read later in the off-main debounce goroutine (see SessionService.flush).
func registerSessionWindow(window application.Window, id string, x, y, w, h int, maximised bool) {
	if sessionSvc == nil {
		return
	}
	sessionSvc.registerWindow(id, x, y, w, h, maximised)
	window.OnWindowEvent(events.Common.WindowDidMove, func(*application.WindowEvent) { sessionSvc.schedulePersist() })
	window.OnWindowEvent(events.Common.WindowDidResize, func(*application.WindowEvent) { sessionSvc.schedulePersist() })
	window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		markEditorWindowClosed(id)
		sessionSvc.handleWindowClosing(id)
	})
}

// startupSpawn opens the right windows at launch based on the prepared session.
// Runs from the ApplicationStarted handler (off the main thread → window ops
// are safe). On a detected crash it prompts before restoring anything.
func startupSpawn() {
	windows := sessionSvc.restorableWindows()
	if len(windows) == 0 {
		// Fresh install with nothing to restore: greet with the bundled Examples.
		if firstLaunch {
			spawnExamplesWindow()
		} else {
			spawnEditorWindow("/")
		}
		return
	}
	if !sessionSvc.previousRunCrashed() {
		for _, w := range windows {
			spawnRestoreWindow(w)
		}
		return
	}
	promptRestore(windows)
}

// promptRestore shows the crash-recovery dialog. Spawning is deferred to a
// goroutine so the window setters never run on whatever thread invokes the
// button callback (they dispatch to the main thread internally).
func promptRestore(windows []WindowSession) {
	app := application.Get()
	dialog := app.Dialog.Question()
	dialog.SetTitle("Restore previous session?")
	dialog.SetMessage("MarkdownMD didn't shut down properly last time. Restore the windows and tabs from your previous session?")
	restore := dialog.AddButton("Restore")
	fresh := dialog.AddButton("Start Fresh")
	dialog.SetDefaultButton(restore)
	dialog.SetCancelButton(fresh)
	// Block termination from the moment the (window-less) prompt goes up until its
	// chosen window(s) have spawned — see restorePromptPending. The defers clear
	// it even if a spawn errors, so the app never gets stuck unquittable.
	restorePromptPending.Store(true)
	restore.OnClick(func() {
		go func() {
			defer restorePromptPending.Store(false)
			for _, w := range windows {
				spawnRestoreWindow(w)
			}
		}()
	})
	fresh.OnClick(func() {
		go func() {
			defer restorePromptPending.Store(false)
			sessionSvc.discardAll()
			spawnEditorWindow("/")
		}()
	})
	dialog.Show()
}
