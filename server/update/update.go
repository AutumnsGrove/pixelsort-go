// Package update is the app's half of the in-app update design (docs/update.md): it reads and writes small signal files
// in a shared folder, and a watcher on the host does the real work. The app never names an image and never contacts the
// registry; the only content it may ever put into `requested` is the word "latest".
package update

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// HeartbeatMaxAge is how old the watcher's heartbeat may be before the updater counts as gone quiet.
const HeartbeatMaxAge = 30 * time.Minute

// RequestBody is the only thing the app writes into `requested`.
const RequestBody = "latest"

// Signals is the signal folder. A nil *Signals means updates are not installed on this deployment.
type Signals struct {
	Dir string
	Now func() time.Time
}

// New returns a Signals for dir, creating it (0700) if needed.
func New(dir string) (*Signals, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("update: signal folder %s: %w", dir, err)
	}
	return &Signals{Dir: dir, Now: time.Now}, nil
}

func (s *Signals) path(name string) string { return filepath.Join(s.Dir, name) }

// writeAtomic writes to a temporary name in the same folder and renames, so a reader never sees half a file.
func (s *Signals) writeAtomic(name string, data []byte) error {
	tmp, err := os.CreateTemp(s.Dir, "."+name+"-*")
	if err != nil {
		return fmt.Errorf("update: write %s: %w", name, err)
	}
	defer func() { _ = os.Remove(tmp.Name()) }() // a no-op once renamed
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("update: write %s: %w", name, err)
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("update: write %s: %w", name, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("update: write %s: %w", name, err)
	}
	if err := os.Rename(tmp.Name(), s.path(name)); err != nil {
		return fmt.Errorf("update: write %s: %w", name, err)
	}
	return nil
}

func (s *Signals) exists(name string) bool {
	_, err := os.Stat(s.path(name))
	return err == nil
}

// Check asks the watcher to look for a newer version now. It does not touch the network.
func (s *Signals) Check() error { return s.writeAtomic("check", []byte("check")) }

// Available returns what the watcher last wrote to available.json, or nil if it has written nothing usable.
func (s *Signals) Available() (json.RawMessage, bool) {
	raw, err := os.ReadFile(s.path("available.json"))
	if err != nil || !json.Valid(raw) {
		return nil, s.exists("check")
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil || obj == nil {
		return nil, s.exists("check")
	}
	return json.RawMessage(bytes.TrimSpace(raw)), s.exists("check")
}

// Start asks the watcher to update to the latest version. A previous result is deleted first, so a stale result is
// never read as this run's answer.
func (s *Signals) Start() error {
	if err := os.Remove(s.path("result")); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("update: clear the old result: %w", err)
	}
	return s.writeAtomic("requested", []byte(RequestBody))
}

// Result is the watcher's answer to an update request.
type Result struct {
	Status   string `json:"status"` // ok | failed | skipped
	Detail   string `json:"detail,omitempty"`
	Rollback string `json:"rollback,omitempty"`
	Target   string `json:"target,omitempty"`
	Finished string `json:"finished_at,omitempty"`
}

// Status reports whether a request is still waiting and what the watcher answered. An unreadable or invalid result is
// reported as a failure rather than an error: the page always gets something it can show.
func (s *Signals) Status() (pending bool, result *json.RawMessage) {
	pending = s.exists("requested")
	raw, err := os.ReadFile(s.path("result"))
	if err != nil {
		return pending, nil
	}
	var r map[string]any
	if json.Unmarshal(raw, &r) != nil || r == nil || !validStatus(r["status"]) {
		bad := json.RawMessage(`{"status":"failed","detail":"The result file could not be read.","rollback":"unknown"}`)
		return pending, &bad
	}
	out := json.RawMessage(bytes.TrimSpace(raw))
	return pending, &out
}

func validStatus(v any) bool {
	s, ok := v.(string)
	return ok && (s == "ok" || s == "failed" || s == "skipped")
}

// HeartbeatAge returns how old the watcher's last heartbeat is. ok is false when there is no heartbeat file. The file's
// content may be an RFC 3339 time or unix seconds; anything else falls back to the file's modification time.
func (s *Signals) HeartbeatAge() (age time.Duration, ok bool) {
	info, err := os.Stat(s.path("heartbeat"))
	if err != nil {
		return 0, false
	}
	stamp := info.ModTime()
	if raw, err := os.ReadFile(s.path("heartbeat")); err == nil {
		text := strings.TrimSpace(string(raw))
		if t, err := time.Parse(time.RFC3339, text); err == nil {
			stamp = t
		} else if n, err := strconv.ParseInt(text, 10, 64); err == nil && n > 0 {
			stamp = time.Unix(n, 0)
		}
	}
	age = s.Now().Sub(stamp)
	return max(age, 0), true
}

// Ready reports whether a watcher has checked in recently enough to trust.
func (s *Signals) Ready() bool {
	if s == nil {
		return false
	}
	age, ok := s.HeartbeatAge()
	return ok && age <= HeartbeatMaxAge
}
