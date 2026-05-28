package main

import (
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// LogBufferSize bounds the in-memory ring buffer of log entries shown in the
// Logs window. Entries past this count silently overwrite the oldest.
const LogBufferSize = 500

// LogLevel values used by Append. Convention only — frontend filtering and
// styling key off these exact strings.
const (
	LogLevelInfo  = "info"
	LogLevelWarn  = "warn"
	LogLevelError = "error"
)

// LogEntry is one row in the Logs window. Timestamp is Unix milliseconds so
// JSON serialisation matches Date.now() on the JS side.
type LogEntry struct {
	Timestamp int64  `json:"timestamp"`
	Level     string `json:"level"`
	Source    string `json:"source"`
	Message   string `json:"message"`
}

// LogService owns a fixed-size ring buffer of LogEntry. App-scoped (one
// buffer per process) — the Logs window in any open window subscribes to the
// same stream.
type LogService struct {
	mu    sync.Mutex
	buf   [LogBufferSize]LogEntry
	head  int // next write index
	count int // 0..LogBufferSize; saturates at LogBufferSize
}

func NewLogService() *LogService {
	return &LogService{}
}

// Append records a new entry and emits a 'log:appended' event with the entry
// as payload. Safe from any goroutine. Source is a free-form identifier of
// the originating module (e.g. "workspace", "explorer", "files").
func (s *LogService) Append(level, source, message string) {
	entry := LogEntry{
		Timestamp: time.Now().UnixMilli(),
		Level:     level,
		Source:    source,
		Message:   message,
	}
	s.mu.Lock()
	s.buf[s.head] = entry
	s.head = (s.head + 1) % LogBufferSize
	if s.count < LogBufferSize {
		s.count++
	}
	s.mu.Unlock()
	if app := application.Get(); app != nil {
		app.Event.Emit("log:appended", entry)
	}
}

// Info / Warn / Error are convenience wrappers around Append for Go-side
// callers. The frontend uses Append directly via the Wails binding.
func (s *LogService) Info(source, message string)  { s.Append(LogLevelInfo, source, message) }
func (s *LogService) Warn(source, message string)  { s.Append(LogLevelWarn, source, message) }
func (s *LogService) Error(source, message string) { s.Append(LogLevelError, source, message) }

// Snapshot returns all entries in chronological order, oldest first. The
// Logs window calls this once on boot for the initial render, then catches
// up incrementally via log:appended events.
func (s *LogService) Snapshot() []LogEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]LogEntry, s.count)
	if s.count < LogBufferSize {
		copy(out, s.buf[:s.count])
		return out
	}
	n := copy(out, s.buf[s.head:])
	copy(out[n:], s.buf[:s.head])
	return out
}

// Clear empties the buffer and emits 'log:cleared' so the Logs window can
// wipe its rendered list. Intended for the Clear button in the Logs UI.
func (s *LogService) Clear() {
	s.mu.Lock()
	s.buf = [LogBufferSize]LogEntry{}
	s.head = 0
	s.count = 0
	s.mu.Unlock()
	if app := application.Get(); app != nil {
		app.Event.Emit("log:cleared", nil)
	}
}
