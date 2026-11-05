package api

import (
	"net"
	"net/http"

	"github.com/AutumnsGrove/pixelsort-go/server/httpx"
)

// notInstalled answers the update endpoints on a deployment without a signal folder (a dev run).
func (a *API) notInstalled(w http.ResponseWriter) bool {
	if a.d.Update == nil {
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "updates are not set up on this server")
		return true
	}
	return false
}

func (a *API) updateCheck(w http.ResponseWriter, _ *http.Request) {
	if a.notInstalled(w) {
		return
	}
	if err := a.d.Update.Check(); err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusAccepted, map[string]bool{"ok": true})
}

func (a *API) updateAvailable(w http.ResponseWriter, _ *http.Request) {
	if a.notInstalled(w) {
		return
	}
	avail, pending := a.d.Update.Available()
	httpx.Write(w, http.StatusOK, map[string]any{"available": avail, "check_pending": pending})
}

// updateStart accepts exactly {"target":"latest"}. Anything else, in particular an image reference, is refused: the app
// never names an image.
func (a *API) updateStart(w http.ResponseWriter, r *http.Request) {
	if a.notInstalled(w) {
		return
	}
	var body struct {
		Target string `json:"target"`
	}
	if err := httpx.Decode(r, &body, 1024); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	if body.Target != "latest" {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, `the only target is "latest"`)
		return
	}
	if a.inflight.Load() > 0 {
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict, "an upload is still running; try again in a moment")
		return
	}
	if err := a.d.Update.Start(); err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusAccepted, map[string]bool{"ok": true})
}

func (a *API) updateStatus(w http.ResponseWriter, _ *http.Request) {
	if a.notInstalled(w) {
		return
	}
	pending, result := a.d.Update.Status()
	httpx.Write(w, http.StatusOK, map[string]any{"pending": pending, "result": result})
}

// busy answers only loopback callers: the watcher polls it from the host before it replaces the container.
func (a *API) busy(w http.ResponseWriter, r *http.Request) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(host); err != nil || ip == nil || !ip.IsLoopback() {
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "not found")
		return
	}
	httpx.Write(w, http.StatusOK, map[string]bool{"busy": a.inflight.Load() > 0})
}

// trackBusy counts requests in flight (uploads), so the watcher can wait for them before replacing the container.
func (a *API) trackBusy(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		a.inflight.Add(1)
		defer a.inflight.Add(-1)
		next(w, r)
	}
}
