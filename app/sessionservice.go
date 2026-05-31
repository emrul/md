package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// SessionService persists and restores the multi-window editing session across
// app restarts. It owns <configHome>/MarkdownMD/session.json.
//
// Ownership split (see ../md-pro/docs/architecture.md "State location rules"):
//   - Go owns window geometry and the clean-shutdown flag.
//   - The frontend owns per-window content (open file tabs + explorer panel
//     state) and pushes it via SaveWindowContent whenever it changes.
//
// Geometry is read ONLY from the off-main-thread debounce goroutine (flush).
// The Wails geometry getters dispatch to the main thread internally, so calling
// them ON the main thread deadlocks — that's why Shutdown (which runs on the
// main thread) serialises the last-captured geometry instead of re-reading it.

// ExplorerSession is the persisted slice of a window's file-explorer panel.
type ExplorerSession struct {
	Open       bool   `json:"open"`
	Width      int    `json:"width"`
	PinnedRoot string `json:"pinnedRoot"`
}

// WindowSession is one window's full restorable state.
type WindowSession struct {
	ID        string `json:"id"`
	X         int    `json:"x"`
	Y         int    `json:"y"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Maximised bool   `json:"maximised"`
	// Tabs are absolute file paths in tab order. Only file-backed tabs are
	// persisted — unsaved "Untitled" drafts are not restored.
	Tabs []string `json:"tabs"`
	// ActiveTab is the path of the active tab, or "" when the active tab was
	// an unsaved draft (restore then falls back to the last opened tab).
	ActiveTab string          `json:"activeTab"`
	Explorer  ExplorerSession `json:"explorer"`
}

// SessionState is the on-disk session document.
type SessionState struct {
	// CleanShutdown is true only after a graceful shutdown wrote the session.
	// A false value on next launch (with windows present) means the previous
	// run crashed, which triggers the restore prompt.
	CleanShutdown bool            `json:"cleanShutdown"`
	Windows       []WindowSession `json:"windows"`
}

// WindowContent is the frontend-owned slice of a window's session state. Used
// as both the SaveWindowContent argument and the GetRestoreWindow result.
type WindowContent struct {
	Tabs      []string        `json:"tabs"`
	ActiveTab string          `json:"activeTab"`
	Explorer  ExplorerSession `json:"explorer"`
}

// sessionPersistDebounce coalesces bursts of content/geometry changes into one
// disk write. Short enough that a quick quit after a change still captures it.
const sessionPersistDebounce = 400 * time.Millisecond

type SessionService struct {
	path string
	logs *LogService

	mu           sync.Mutex
	windows      map[string]*WindowSession
	order        []string // window ids in creation order
	shuttingDown bool
	timer        *time.Timer

	// pendingCrashed is computed by PrepareStartup and read by the startup
	// orchestration to decide whether to prompt before restoring.
	pendingCrashed bool
}

func NewSessionService(logs *LogService) (*SessionService, error) {
	configDir := application.Path(application.PathConfigHome)
	if configDir == "" {
		return nil, errors.New("could not resolve user config dir")
	}
	dir := filepath.Join(configDir, "MarkdownMD")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create config dir: %w", err)
	}
	return &SessionService{
		path:    filepath.Join(dir, "session.json"),
		logs:    logs,
		windows: make(map[string]*WindowSession),
	}, nil
}

// prepareStartup loads the previous session, drops windows whose files are all
// gone, primes the in-memory state, and marks the on-disk session dirty so a
// crash this run is detectable next launch. It performs file I/O only (no
// window operations) and is safe to call before app.Run.
//
// Returns true when a restore prompt is warranted: the previous run did not
// shut down cleanly AND there is at least one restorable window.
//
// Unexported so it isn't bound to the frontend — only main calls it.
func (s *SessionService) prepareStartup() bool {
	st := s.load()
	prevClean := st.CleanShutdown

	s.mu.Lock()
	s.windows = make(map[string]*WindowSession)
	s.order = nil
	for i := range st.Windows {
		w := st.Windows[i]
		var tabs []string
		for _, p := range w.Tabs {
			if isRegularFile(p) {
				tabs = append(tabs, p)
			}
		}
		if len(tabs) == 0 {
			continue // window has no surviving file tabs — don't restore it
		}
		w.Tabs = tabs
		if w.ActiveTab != "" && !containsStr(tabs, w.ActiveTab) {
			w.ActiveTab = ""
		}
		ws := w
		s.windows[ws.ID] = &ws
		s.order = append(s.order, ws.ID)
	}
	crashed := !prevClean && len(s.order) > 0
	s.pendingCrashed = crashed
	s.mu.Unlock()

	s.writeState(false)
	return crashed
}

// restorableWindows returns copies of the primed windows, in creation order.
func (s *SessionService) restorableWindows() []WindowSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]WindowSession, 0, len(s.order))
	for _, id := range s.order {
		if ws := s.windows[id]; ws != nil {
			out = append(out, *ws)
		}
	}
	return out
}

// previousRunCrashed reports whether the last session ended uncleanly.
func (s *SessionService) previousRunCrashed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pendingCrashed
}

// --- Bound methods (called from the frontend) ---

// GetRestoreWindow returns the tabs + explorer state a restored window should
// load. Returns an empty payload (not an error) for unknown ids.
func (s *SessionService) GetRestoreWindow(id string) (WindowContent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ws := s.windows[id]
	if ws == nil {
		return WindowContent{Tabs: []string{}}, nil
	}
	tabs := make([]string, len(ws.Tabs))
	copy(tabs, ws.Tabs)
	return WindowContent{Tabs: tabs, ActiveTab: ws.ActiveTab, Explorer: ws.Explorer}, nil
}

// SaveWindowContent records the current tabs + explorer state for a window.
// The frontend calls this (debounced) whenever its structure changes.
func (s *SessionService) SaveWindowContent(id string, content WindowContent) error {
	if id == "" {
		return nil
	}
	s.mu.Lock()
	ws := s.windows[id]
	if ws == nil {
		ws = &WindowSession{ID: id, Width: defaultWindowWidth, Height: defaultWindowHeight}
		s.windows[id] = ws
		s.order = append(s.order, id)
	}
	if content.Tabs == nil {
		ws.Tabs = []string{}
	} else {
		ws.Tabs = content.Tabs
	}
	ws.ActiveTab = content.ActiveTab
	ws.Explorer = content.Explorer
	s.mu.Unlock()
	s.schedulePersist()
	return nil
}

// --- Internal lifecycle (same-package callers in windowservice.go / main.go) ---

// registerWindow records a freshly spawned window's id + geometry, preserving
// any tabs already primed for that id (the restore case).
func (s *SessionService) registerWindow(id string, x, y, w, h int, maximised bool) {
	s.mu.Lock()
	ws := s.windows[id]
	if ws == nil {
		ws = &WindowSession{ID: id, Tabs: []string{}}
		s.windows[id] = ws
		s.order = append(s.order, id)
	}
	ws.X, ws.Y, ws.Width, ws.Height, ws.Maximised = x, y, w, h, maximised
	s.mu.Unlock()
	s.schedulePersist()
}

// handleWindowClosing drops a window from the session when the user closes it
// (so we don't restore a window they intentionally closed). Closes that happen
// during app shutdown are ignored — those windows must survive into restore.
func (s *SessionService) handleWindowClosing(id string) {
	s.mu.Lock()
	if s.shuttingDown {
		s.mu.Unlock()
		return
	}
	if _, ok := s.windows[id]; ok {
		delete(s.windows, id)
		s.order = removeStr(s.order, id)
	}
	s.mu.Unlock()
	s.writeState(false)
}

// discardAll clears the session (used when the user declines a crash restore).
func (s *SessionService) discardAll() {
	s.mu.Lock()
	s.windows = make(map[string]*WindowSession)
	s.order = nil
	s.mu.Unlock()
	s.writeState(false)
}

// shutdown is the graceful-exit hook: stop the debounce, mark the session
// clean, and write it. Runs on the main thread, so it must NOT read window
// geometry (the getters would deadlock) — it serialises the last capture.
//
// Unexported so it isn't bound to the frontend — only main wires it.
func (s *SessionService) shutdown() {
	s.mu.Lock()
	s.shuttingDown = true
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	s.mu.Unlock()
	s.writeState(true)
}

// schedulePersist (re)arms the debounce timer. The timer fires on its own
// goroutine — off the main thread — so flush can read window geometry safely.
func (s *SessionService) schedulePersist() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.shuttingDown {
		return
	}
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(sessionPersistDebounce, s.flush)
}

func (s *SessionService) flush() {
	s.captureAllGeometry()
	s.writeState(false)
}

// captureAllGeometry refreshes each tracked window's geometry from the live
// window. MUST run off the main thread (the getters dispatch to it internally).
func (s *SessionService) captureAllGeometry() {
	s.mu.Lock()
	ids := append([]string(nil), s.order...)
	s.mu.Unlock()

	app := application.Get()
	if app == nil {
		return
	}
	for _, id := range ids {
		win, ok := app.Window.GetByName(id)
		if !ok {
			continue
		}
		x, y := win.RelativePosition()
		w, h := win.Size()
		if w <= 0 || h <= 0 {
			continue // window not laid out yet; keep the last known size
		}
		maximised := win.IsMaximised()
		s.mu.Lock()
		if ws := s.windows[id]; ws != nil {
			ws.X, ws.Y, ws.Width, ws.Height, ws.Maximised = x, y, w, h, maximised
		}
		s.mu.Unlock()
	}
}

func (s *SessionService) buildState(clean bool) SessionState {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := SessionState{CleanShutdown: clean, Windows: make([]WindowSession, 0, len(s.order))}
	for _, id := range s.order {
		if ws := s.windows[id]; ws != nil {
			st.Windows = append(st.Windows, *ws)
		}
	}
	return st
}

// writeState serialises the session atomically (temp file + rename) so a crash
// mid-write can't leave a truncated session.json.
func (s *SessionService) writeState(clean bool) {
	st := s.buildState(clean)
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		s.logf("marshal session: %v", err)
		return
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		s.logf("write session: %v", err)
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		s.logf("replace session: %v", err)
	}
}

// load reads session.json. A missing or corrupt file is treated as a clean,
// empty session (no restore, no prompt).
func (s *SessionService) load() SessionState {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return SessionState{CleanShutdown: true}
	}
	var st SessionState
	if err := json.Unmarshal(data, &st); err != nil {
		s.logf("parse session.json: %v", err)
		return SessionState{CleanShutdown: true}
	}
	return st
}

func (s *SessionService) logf(format string, args ...any) {
	if s.logs != nil {
		s.logs.Warn("session", fmt.Sprintf(format, args...))
	}
}

func isRegularFile(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.Mode().IsRegular()
}

func containsStr(ss []string, target string) bool {
	for _, s := range ss {
		if s == target {
			return true
		}
	}
	return false
}

func removeStr(ss []string, target string) []string {
	out := ss[:0]
	for _, s := range ss {
		if s != target {
			out = append(out, s)
		}
	}
	return out
}
