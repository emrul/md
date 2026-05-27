package main

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
}

func defaultPreferences() Preferences {
	return Preferences{
		UseTabs: true,
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

func (s *PreferencesService) write(prefs Preferences) error {
	f, err := os.OpenFile(s.path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	return toml.NewEncoder(f).Encode(prefs)
}
