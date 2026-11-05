package update_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server/update"
)

func newSignals(t *testing.T) *update.Signals {
	t.Helper()
	s, err := update.New(filepath.Join(t.TempDir(), "signal"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func write(t *testing.T, s *update.Signals, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(s.Dir, name), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestCheckWritesTheSignalAndAvailableReadsTheWatchersFile(t *testing.T) {
	s := newSignals(t)
	if a, pending := s.Available(); a != nil || pending {
		t.Fatalf("nothing yet: %s %v", a, pending)
	}
	if err := s.Check(); err != nil {
		t.Fatal(err)
	}
	if _, pending := s.Available(); !pending {
		t.Fatal("a check is pending after Check")
	}
	write(t, s, "available.json", `{"update_available":true,"latest":"r14.9a1c4e2"}`)
	a, _ := s.Available()
	if string(a) != `{"update_available":true,"latest":"r14.9a1c4e2"}` {
		t.Fatalf("%s", a)
	}
	write(t, s, "available.json", `not json`)
	if a, _ := s.Available(); a != nil {
		t.Fatal("an invalid available.json must read as nothing")
	}
}

func TestStartWritesOnlyLatestAndClearsTheOldResult(t *testing.T) {
	s := newSignals(t)
	write(t, s, "result", `{"status":"failed","finished_at":"2020-01-01T00:00:00Z"}`)
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(s.Dir, "requested"))
	if err != nil || string(got) != "latest" {
		t.Fatalf("requested = %q %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "result")); !os.IsNotExist(err) {
		t.Fatal("the old result survived Start")
	}
	pending, res := s.Status()
	if !pending || res != nil {
		t.Fatalf("pending %v result %v", pending, res)
	}
}

func TestStatusReportsAnInvalidResultAsAFailure(t *testing.T) {
	s := newSignals(t)
	for name, body := range map[string]string{"garbage": "\x00not json", "wrong status": `{"status":"banana"}`, "not an object": `[1]`, "null": `null`} {
		write(t, s, "result", body)
		_, res := s.Status()
		if res == nil {
			t.Fatalf("%s: no result", name)
		}
		var r update.Result
		if err := json.Unmarshal(*res, &r); err != nil || r.Status != "failed" || r.Rollback != "unknown" {
			t.Fatalf("%s: %s %v", name, *res, err)
		}
	}
	write(t, s, "result", `{"status":"ok","target":"r14.9a1c4e2","finished_at":"2026-11-05T00:00:00Z"}`)
	if _, res := s.Status(); res == nil || string(*res) != `{"status":"ok","target":"r14.9a1c4e2","finished_at":"2026-11-05T00:00:00Z"}` {
		t.Fatalf("a good result must pass through: %v", res)
	}
}

func TestHeartbeatAge(t *testing.T) {
	s := newSignals(t)
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return now }
	if s.Ready() {
		t.Fatal("no heartbeat file: not ready")
	}
	write(t, s, "heartbeat", now.Add(-29*time.Minute).Format(time.RFC3339))
	if !s.Ready() {
		t.Fatal("a 29 minute old heartbeat is ready")
	}
	write(t, s, "heartbeat", now.Add(-31*time.Minute).Format(time.RFC3339))
	if s.Ready() {
		t.Fatal("a 31 minute old heartbeat means not installed")
	}
	write(t, s, "heartbeat", strconv.FormatInt(now.Add(-time.Minute).Unix(), 10))
	if age, ok := s.HeartbeatAge(); !ok || age != time.Minute {
		t.Fatalf("unix seconds: %v %v", age, ok)
	}
	var nilSignals *update.Signals
	if nilSignals.Ready() {
		t.Fatal("a nil Signals is never ready")
	}
}

// A reader polling while the file is rewritten 1000 times never sees a partial file.
func TestWritesAreAtomic(t *testing.T) {
	s := newSignals(t)
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	torn := 0
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			if b, err := os.ReadFile(filepath.Join(s.Dir, "check")); err == nil && string(b) != "check" {
				torn++
			}
		}
	}()
	for i := 0; i < 1000; i++ {
		if err := s.Check(); err != nil {
			t.Fatal(err)
		}
	}
	close(stop)
	wg.Wait()
	if torn != 0 {
		t.Fatalf("%d torn reads", torn)
	}
	entries, _ := os.ReadDir(s.Dir)
	for _, e := range entries {
		if e.Name() != "check" {
			t.Errorf("a temp file was left behind: %s", e.Name())
		}
	}
	info, _ := os.Stat(filepath.Join(s.Dir, "check"))
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", info.Mode().Perm())
	}
}
