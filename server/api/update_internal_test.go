package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server/update"
)

func newUpdateAPI(t *testing.T) (*API, *update.Signals) {
	t.Helper()
	s, err := update.New(filepath.Join(t.TempDir(), "signal"))
	if err != nil {
		t.Fatal(err)
	}
	return New(Deps{Update: s, Deployment: "docker", EngineVersion: "1"}), s
}

func do(a *API, method, path, body, remote string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if remote != "" {
		req.RemoteAddr = remote
	}
	rec := httptest.NewRecorder()
	a.Handler().ServeHTTP(rec, req)
	return rec
}

func TestStartRefusesAnythingButLatest(t *testing.T) {
	a, s := newUpdateAPI(t)
	for _, body := range []string{
		`{"target":"ghcr.io/evil/x@sha256:` + strings.Repeat("a", 64) + `"}`, `{"target":""}`, `{}`, `{"target":"latest","image":"x"}`, `latest`, `[]`,
	} {
		if rec := do(a, "POST", "/api/update/start", body, ""); rec.Code != 400 {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "requested")); !os.IsNotExist(err) {
		t.Fatal("a refused request still wrote the signal file")
	}
	if rec := do(a, "POST", "/api/update/start", `{"target":"latest"}`, ""); rec.Code != 202 {
		t.Fatalf("latest: %d %s", rec.Code, rec.Body)
	}
	if b, _ := os.ReadFile(filepath.Join(s.Dir, "requested")); string(b) != "latest" {
		t.Fatalf("requested = %q", b)
	}
}

func TestStartDeletesTheOldResultAndRefusesWhileBusy(t *testing.T) {
	a, s := newUpdateAPI(t)
	_ = os.WriteFile(filepath.Join(s.Dir, "result"), []byte(`{"status":"ok"}`), 0o600)
	a.inflight.Add(1)
	if rec := do(a, "POST", "/api/update/start", `{"target":"latest"}`, ""); rec.Code != http.StatusConflict {
		t.Fatalf("while an upload runs: %d", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "result")); err != nil {
		t.Fatal("a refused start must not touch the old result")
	}
	a.inflight.Add(-1)
	if rec := do(a, "POST", "/api/update/start", `{"target":"latest"}`, ""); rec.Code != 202 {
		t.Fatalf("%d", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "result")); !os.IsNotExist(err) {
		t.Fatal("start must delete the previous result")
	}
}

func TestAvailableStatusAndCheck(t *testing.T) {
	a, s := newUpdateAPI(t)
	if rec := do(a, "GET", "/api/update/available", "", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"available":null`) || !strings.Contains(rec.Body.String(), `"check_pending":false`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if rec := do(a, "POST", "/api/update/check", "", ""); rec.Code != 202 {
		t.Fatalf("check: %d", rec.Code)
	}
	if rec := do(a, "GET", "/api/update/available", "", ""); !strings.Contains(rec.Body.String(), `"check_pending":true`) {
		t.Fatalf("%s", rec.Body)
	}
	_ = os.WriteFile(filepath.Join(s.Dir, "result"), []byte("garbage"), 0o600)
	rec := do(a, "GET", "/api/update/status", "", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"status":"failed"`) || !strings.Contains(rec.Body.String(), `"rollback":"unknown"`) {
		t.Fatalf("an invalid result must read as failed, not 500: %d %s", rec.Code, rec.Body)
	}
}

func TestBusyAnswersOnlyLoopback(t *testing.T) {
	a, _ := newUpdateAPI(t)
	if rec := do(a, "GET", "/api/busy", "", "203.0.113.9:5555"); rec.Code != 404 {
		t.Fatalf("a remote caller: %d", rec.Code)
	}
	if rec := do(a, "GET", "/api/busy", "", "127.0.0.1:5555"); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"busy":false`) {
		t.Fatalf("loopback v4: %d %s", rec.Code, rec.Body)
	}
	a.inflight.Add(1)
	if rec := do(a, "GET", "/api/busy", "", "[::1]:5555"); !strings.Contains(rec.Body.String(), `"busy":true`) {
		t.Fatalf("loopback v6 while busy: %s", rec.Body)
	}
}

func TestVersionReportsTheUpdater(t *testing.T) {
	a, s := newUpdateAPI(t)
	if rec := do(a, "GET", "/api/version", "", ""); !strings.Contains(rec.Body.String(), `"updater":"not installed"`) {
		t.Fatalf("no heartbeat: %s", rec.Body)
	}
	now := time.Now()
	_ = os.WriteFile(filepath.Join(s.Dir, "heartbeat"), []byte(now.Add(-2*time.Minute).UTC().Format(time.RFC3339)), 0o600)
	if rec := do(a, "GET", "/api/version", "", ""); !strings.Contains(rec.Body.String(), `"updater":"ready"`) || !strings.Contains(rec.Body.String(), "heartbeat_age_s") {
		t.Fatalf("%s", rec.Body)
	}
	_ = os.WriteFile(filepath.Join(s.Dir, "heartbeat"), []byte(now.Add(-31*time.Minute).UTC().Format(time.RFC3339)), 0o600)
	if rec := do(a, "GET", "/api/version", "", ""); !strings.Contains(rec.Body.String(), `"updater":"not installed"`) {
		t.Fatalf("a 31 minute old heartbeat: %s", rec.Body)
	}
}

func TestUpdateEndpointsAreOffWithoutAFolder(t *testing.T) {
	a := New(Deps{})
	for _, p := range []string{"/api/update/available", "/api/update/status"} {
		if rec := do(a, "GET", p, "", ""); rec.Code != 404 {
			t.Errorf("%s: %d", p, rec.Code)
		}
	}
	if rec := do(a, "GET", "/api/version", "", ""); !strings.Contains(rec.Body.String(), `"updater":"not installed"`) {
		t.Fatalf("%s", rec.Body)
	}
}

func TestHealthzHasExactlyTwoKeys(t *testing.T) {
	a, _ := newUpdateAPI(t)
	rec := do(a, "GET", "/healthz", "", "")
	if n := strings.Count(rec.Body.String(), `":"`); n != 2 {
		t.Fatalf("%d keys in %s", n, rec.Body)
	}
}
