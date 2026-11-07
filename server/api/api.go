// Package api is the gallery's HTTP surface. Handlers decode, call the runs service, and encode; the rules live in
// runs and the storage in blob.
package api

import (
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"sync/atomic"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/internal/version"
	"github.com/AutumnsGrove/pixelsort-go/server/blob"
	"github.com/AutumnsGrove/pixelsort-go/server/httpx"
	"github.com/AutumnsGrove/pixelsort-go/server/runs"
	"github.com/AutumnsGrove/pixelsort-go/server/share"
	"github.com/AutumnsGrove/pixelsort-go/server/update"
)

// Deps is what the handlers need.
type Deps struct {
	Runs           *runs.Service
	Blobs          *blob.Store
	BudgetBytes    int64
	MaxUploadBytes int64
	Deployment     string
	EngineVersion  string
	Update         *update.Signals // nil when no update folder is configured
	Share          *share.Service  // nil when the share Worker is not configured
	Helper         bool            // the Shape helper is set up (its route is served by the app, not by this API)
}

// API holds the handlers and remembers which routes it registered.
type API struct {
	d        Deps
	mux      *http.ServeMux
	routes   []string
	inflight atomic.Int64 // uploads in progress, for GET /api/busy and for refusing an update mid-upload

	fetchLimit bucket
	now        func() time.Time // the clock, replaced in tests
}

// New builds the API. Every route carries the shared middleware: request id, recovery, access log and a timeout for
// everything except uploads and image downloads, which may legitimately take longer.
func New(d Deps) *API {
	a := &API{d: d, mux: http.NewServeMux(), now: time.Now}
	a.handle("GET /healthz", a.healthz)
	a.handle("GET /api/version", a.version)
	a.handle("POST /api/runs", a.trackBusy(a.createRun))
	a.handle("POST /api/update/check", a.updateCheck)
	a.handle("GET /api/update/available", a.updateAvailable)
	a.handle("POST /api/update/start", a.updateStart)
	a.handle("GET /api/update/status", a.updateStatus)
	a.handle("GET /api/busy", a.busy)
	a.handle("GET /api/features", a.features)
	a.handle("POST /api/shares", a.createShare)
	a.handle("GET /api/shares", a.listShares)
	a.handle("DELETE /api/shares/{id}", a.revokeShare)
	a.handle("POST /api/fetch", a.fetchURL)
	a.handle("POST /api/images/check", a.checkImage)
	a.handle("GET /api/images/{sha256}", a.getImage)
	a.handle("GET /api/runs", a.listRuns)
	a.handle("GET /api/runs/{id}", a.getRun)
	a.handle("PATCH /api/runs/{id}", a.patchRun)
	a.handle("POST /api/runs/trash", a.trashRuns)
	a.handle("POST /api/runs/restore", a.restoreRuns)
	a.handle("POST /api/runs/delete", a.deleteRuns)
	a.handle("POST /api/trash/empty", a.emptyTrash)
	a.handle("GET /api/usage", a.usage)
	a.handle("GET /api/presets", a.listPresets)
	a.handle("POST /api/presets", a.addPreset)
	a.handle("DELETE /api/presets/{id}", a.deletePreset)
	a.handle("GET /api/settings", a.getSettings)
	a.handle("PUT /api/settings", a.putSettings)
	a.handle("GET /api/shapes", a.listShapes)
	a.handle("POST /api/shapes", a.addShape)
	a.handle("DELETE /api/shapes/{id}", a.deleteShape)
	// Anything else under /api is a JSON 404, so the SPA fallback never answers for an API typo.
	a.mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "no such endpoint")
	})
	return a
}

// Handler returns the API with its middleware.
func (a *API) Handler() http.Handler {
	return httpx.Chain(a.mux, httpx.RequestID, httpx.Recover, httpx.AccessLog)
}

// Routes lists every registered "METHOD /path" pattern, sorted; a test keeps docs/api.md in step with it.
func (a *API) Routes() []string {
	out := append([]string(nil), a.routes...)
	sort.Strings(out)
	return out
}

func (a *API) handle(pattern string, h http.HandlerFunc) {
	a.routes = append(a.routes, pattern)
	var handler http.Handler = h
	if pattern != "POST /api/runs" && pattern != "GET /api/images/{sha256}" && pattern != "POST /api/shares" && pattern != "POST /api/fetch" {
		handler = httpx.Timeout(30 * time.Second)(handler)
	}
	a.mux.Handle(pattern, handler)
}

// fail maps a service error to the error envelope.
func fail(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	switch {
	case errors.Is(err, runs.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "not found")
	case errors.Is(err, runs.ErrConflict):
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict, cleanMessage(err))
	case errors.Is(err, runs.ErrInvalid):
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, cleanMessage(err))
	case errors.Is(err, blob.ErrTooLarge), errors.Is(err, httpx.ErrBodyTooLarge), errors.As(err, &tooBig):
		httpx.Error(w, http.StatusRequestEntityTooLarge, httpx.CodeTooLarge, "that upload is too large")
	case errors.Is(err, blob.ErrBadType):
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadType, "that file is not a PNG, JPEG, WebP or GIF image")
	case errors.Is(err, blob.ErrHashMismatch):
		httpx.Error(w, http.StatusBadRequest, httpx.CodeHashMismatch, "an uploaded file does not match its declared hash")
	case errors.Is(err, blob.ErrBadSHA):
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "bad sha256")
	default:
		slog.Error("request failed", "err", err)
		httpx.Error(w, http.StatusInternalServerError, httpx.CodeInternal, "something went wrong")
	}
}

// cleanMessage drops the package prefix so a message reads well to a person.
func cleanMessage(err error) string {
	msg := err.Error()
	for _, p := range []string{"runs: invalid input: ", "runs: conflict: "} {
		if len(msg) > len(p) && msg[:len(p)] == p {
			return msg[len(p):]
		}
	}
	return msg
}

func (a *API) healthz(w http.ResponseWriter, _ *http.Request) {
	httpx.Write(w, http.StatusOK, map[string]string{"status": "ok", "version": version.Version})
}

func (a *API) version(w http.ResponseWriter, _ *http.Request) {
	out := map[string]any{"version": version.Version, "deployment": a.d.Deployment, "engine_version": a.d.EngineVersion, "updater": "not installed"}
	if a.d.Update.Ready() {
		out["updater"] = "ready"
	}
	if a.d.Update != nil {
		if age, ok := a.d.Update.HeartbeatAge(); ok {
			out["heartbeat_age_s"] = int64(age.Seconds())
		}
	}
	httpx.Write(w, http.StatusOK, out)
}
