package api

import (
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server/httpx"
)

const (
	fetchPerMinute = 30
	maxFetchURL    = 4096
)

// bucket is a token bucket: fetchPerMinute tokens, refilled evenly, so a bug cannot hammer the Worker.
type bucket struct {
	mu     sync.Mutex
	tokens float64
	last   time.Time
}

func (b *bucket) allow(now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.last.IsZero() {
		b.tokens, b.last = fetchPerMinute, now
	}
	b.tokens += now.Sub(b.last).Seconds() * fetchPerMinute / 60
	if b.tokens > fetchPerMinute {
		b.tokens = fetchPerMinute
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// fetchURL handles POST /api/fetch: the Worker loads the picture, this streams it back. The browser never sees the
// Worker's address or secret, and the Worker's own error codes (link-blocked and friends) pass through unchanged.
func (a *API) fetchURL(w http.ResponseWriter, r *http.Request) {
	if !a.shareReady(w) {
		return
	}
	var in struct {
		URL string `json:"url"`
	}
	if err := httpx.Decode(r, &in, 8<<10); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	if in.URL == "" || len(in.URL) > maxFetchURL {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "url is required")
		return
	}
	if !a.fetchLimit.allow(a.now()) {
		w.Header().Set("Retry-After", "2")
		httpx.Error(w, http.StatusTooManyRequests, httpx.CodeRateLimited, "too many links at once; wait a moment")
		return
	}
	resp, err := a.d.Share.Client.Fetch(r.Context(), in.URL)
	if err != nil {
		failShare(w, err)
		return
	}
	defer resp.Body.Close() //nolint:errcheck // nothing to do about a failed close
	for _, h := range []string{"Content-Type", "X-Source-URL", "Cache-Control", "X-Content-Type-Options"} {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
