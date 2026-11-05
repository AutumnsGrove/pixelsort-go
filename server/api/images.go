package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server/blob"
	"github.com/AutumnsGrove/pixelsort-go/server/httpx"
)

// getImage serves a stored image. Content is addressed by hash, so it never changes and can be cached forever.
func (a *API) getImage(w http.ResponseWriter, r *http.Request) {
	f, b, err := a.d.Blobs.Open(r.PathValue("sha256"))
	if err != nil {
		if errors.Is(err, blob.ErrBadSHA) || errors.Is(err, blob.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "not found") // a bad hash is a 404 too: do not reveal the rule
			return
		}
		fail(w, err)
		return
	}
	defer f.Close() //nolint:errcheck // read-only file
	h := w.Header()
	h.Set("Content-Type", b.Mime)
	h.Set("ETag", `"`+b.SHA+`"`)
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Disposition", "inline")
	http.ServeContent(w, r, "", time.Time{}, f)
}
