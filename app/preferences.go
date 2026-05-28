package app

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Preferences holds user-tunable settings persisted to a TOML file in the
// user's OS config dir. Fields use snake_case for the TOML keys and camelCase
// for the JSON wire format the frontend consumes.
type Preferences struct {
	// UseTabs controls whether File>Open adds a tab (true) or opens a new
	// window with a single tab (false). Defaults to true.
	UseTabs bool `toml:"use_tabs" json:"useTabs"`
	// ShowDotFolders controls whether dot-prefixed directories (e.g.
	// .config, .github) appear in the explorer. Default false — `~/` has
	// dozens of them and they're rarely the markdown writer's focus.
	// Dotfiles (regular files starting with `.`) are always hidden in M3.
	ShowDotFolders bool `toml:"show_dotfolders" json:"showDotFolders"`
	// PinnedRoots is the user's persistent set of pinned explorer roots,
	// surfaced as the top section of the Files header dropdown. Order on
	// disk is insertion order; the frontend sorts alpha at render time.
	PinnedRoots []string `toml:"pinned_roots" json:"pinnedRoots"`
	// RecentRoots is the LRU history of roots the explorer has shown
	// (most-recent first), capped at RecentRootsCap. Pinned items don't
	// appear here — pinning removes from recent and adds to pinned.
	RecentRoots []string `toml:"recent_roots" json:"recentRoots"`
}

// RecentRootsCap bounds RecentRoots. The 11th eviction drops the tail.
const RecentRootsCap = 10

func defaultPreferences() Preferences {
	return Preferences{
		UseTabs:        true,
		ShowDotFolders: false,
		PinnedRoots:    []string{},
		RecentRoots:    []string{},
	}
}

type PreferencesService struct {
	path string
}

// NewPreferencesService resolves the on-disk preferences path and ensures
// the file exists with defaults if missing.
func NewPreferencesService() (*PreferencesService, error) {
	configDir := application.Path(application.PathConfigHome)
	if configDir == "" {
		return nil, errors.New("could not resolve user config dir")
	}
	dir := filepath.Join(configDir, "MarkdownMD")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create config dir: %w", err)
	}
	svc := &PreferencesService{path: filepath.Join(dir, "preferences.toml")}
	if _, err := os.Stat(svc.path); errors.Is(err, fs.ErrNotExist) {
		if err := svc.write(defaultPreferences()); err != nil {
			return nil, err
		}
	}
	return svc, nil
}

// Get returns the current preferences, falling back to defaults for missing
// fields. Hand-edits to the TOML file are picked up on the next call.
func (s *PreferencesService) Get() (Preferences, error) {
	prefs := defaultPreferences()
	data, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return prefs, nil
		}
		return prefs, err
	}
	if _, err := toml.Decode(string(data), &prefs); err != nil {
		return prefs, fmt.Errorf("parse preferences.toml: %w", err)
	}
	return prefs, nil
}

// Set replaces the on-disk preferences with the given value.
func (s *PreferencesService) Set(prefs Preferences) error {
	return s.write(prefs)
}

// TrackRecentRoot promotes path to the front of RecentRoots, capping at
// RecentRootsCap. If the path is already pinned, this is a no-op (pinned
// items never appear in RecentRoots). Returns the resulting preferences
// so the frontend can refresh its cache in one round-trip.
func (s *PreferencesService) TrackRecentRoot(path string) (Preferences, error) {
	prefs, err := s.Get()
	if err != nil {
		return prefs, err
	}
	if path == "" {
		return prefs, nil
	}
	for _, p := range prefs.PinnedRoots {
		if p == path {
			return prefs, nil
		}
	}
	filtered := make([]string, 0, len(prefs.RecentRoots)+1)
	filtered = append(filtered, path)
	for _, p := range prefs.RecentRoots {
		if p == path {
			continue
		}
		filtered = append(filtered, p)
	}
	if len(filtered) > RecentRootsCap {
		filtered = filtered[:RecentRootsCap]
	}
	prefs.RecentRoots = filtered
	if err := s.write(prefs); err != nil {
		return prefs, err
	}
	return prefs, nil
}

// TogglePinnedRoot moves path between RecentRoots and PinnedRoots. Pin →
// remove from recent, add to pinned (preserving insertion order). Unpin →
// remove from pinned, add to top of recent (so it stays handy).
func (s *PreferencesService) TogglePinnedRoot(path string) (Preferences, error) {
	prefs, err := s.Get()
	if err != nil {
		return prefs, err
	}
	if path == "" {
		return prefs, nil
	}
	pinnedIdx := -1
	for i, p := range prefs.PinnedRoots {
		if p == path {
			pinnedIdx = i
			break
		}
	}
	if pinnedIdx >= 0 {
		// Unpin
		prefs.PinnedRoots = append(prefs.PinnedRoots[:pinnedIdx], prefs.PinnedRoots[pinnedIdx+1:]...)
		// Bring to top of recents
		recent := make([]string, 0, len(prefs.RecentRoots)+1)
		recent = append(recent, path)
		for _, p := range prefs.RecentRoots {
			if p == path {
				continue
			}
			recent = append(recent, p)
		}
		if len(recent) > RecentRootsCap {
			recent = recent[:RecentRootsCap]
		}
		prefs.RecentRoots = recent
	} else {
		// Pin
		prefs.PinnedRoots = append(prefs.PinnedRoots, path)
		// Remove from recents
		filtered := prefs.RecentRoots[:0]
		for _, p := range prefs.RecentRoots {
			if p != path {
				filtered = append(filtered, p)
			}
		}
		prefs.RecentRoots = filtered
	}
	if err := s.write(prefs); err != nil {
		return prefs, err
	}
	return prefs, nil
}

func (s *PreferencesService) write(prefs Preferences) error {
	f, err := os.OpenFile(s.path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	return toml.NewEncoder(f).Encode(prefs)
}
