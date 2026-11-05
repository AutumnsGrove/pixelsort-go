package api

import (
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/AutumnsGrove/pixelsort-go/server/httpx"
	"github.com/AutumnsGrove/pixelsort-go/server/share"
)

const (
	codeNotConfigured = "not_configured"
	codeUpstream      = "upstream_failed"
	maxShareMeta      = 64 << 10
	maxOriginalBytes  = 30 << 20
)

// shareReady answers 503 when the Worker is not configured. Everything share and fetch related goes through it.
func (a *API) shareReady(w http.ResponseWriter) bool {
	if a.d.Share == nil {
		httpx.Error(w, http.StatusServiceUnavailable, codeNotConfigured, "sharing is not set up on this server")
		return false
	}
	return true
}

// features tells the web app which optional parts to show.
func (a *API) features(w http.ResponseWriter, _ *http.Request) {
	on := a.d.Share != nil
	httpx.Write(w, http.StatusOK, map[string]bool{"share": on, "fetch": on})
}

// failShare maps a share error to the error envelope. The Worker's address and secret are never in a message.
func failShare(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, share.ErrOriginalsMissing):
		httpx.Error(w, http.StatusBadRequest, "originals_required", "include_original needs a metadata-stripped original for every run")
	case errors.Is(err, share.ErrInvalid):
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, strings.TrimPrefix(err.Error(), "share: invalid input: "))
	case errors.Is(err, share.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "not found")
	case errors.Is(err, share.ErrWorker):
		slog.Warn("share worker failed", "err", err)
		httpx.Error(w, http.StatusBadGateway, codeUpstream, "the share service did not answer; nothing was changed")
	default:
		fail(w, err)
	}
}

// createShare handles POST /api/shares: JSON, or multipart with a "meta" JSON field and "orig-<run_id>" files.
func (a *API) createShare(w http.ResponseWriter, r *http.Request) {
	if !a.shareReady(w) {
		return
	}
	var req share.CreateRequest
	originals := map[int64]share.Original{}
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if ct == "multipart/form-data" {
		r.Body = http.MaxBytesReader(w, r.Body, int64(share.MaxImages)*maxOriginalBytes)
		if err := r.ParseMultipartForm(8 << 20); err != nil { //nolint:gosec // G120: bounded by the MaxBytesReader above
			fail(w, classifyMultipart(err))
			return
		}
		defer func() { _ = r.MultipartForm.RemoveAll() }()
		meta := r.MultipartForm.Value["meta"]
		if len(meta) != 1 {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "the request needs exactly one meta field")
			return
		}
		if err := httpx.DecodeReader(strings.NewReader(meta[0]), &req, maxShareMeta); err != nil {
			httpx.BadJSON(w, err)
			return
		}
		for name, files := range r.MultipartForm.File {
			id, err := strconv.ParseInt(strings.TrimPrefix(name, "orig-"), 10, 64)
			if err != nil || !strings.HasPrefix(name, "orig-") || len(files) != 1 {
				httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "unexpected file part "+strconv.Quote(name))
				return
			}
			f, err := files[0].Open()
			if err != nil {
				fail(w, err)
				return
			}
			data, err := io.ReadAll(io.LimitReader(f, maxOriginalBytes+1))
			_ = f.Close()
			if err != nil {
				fail(w, err)
				return
			}
			if len(data) > maxOriginalBytes {
				fail(w, httpx.ErrBodyTooLarge)
				return
			}
			originals[id] = share.Original{Mime: http.DetectContentType(data), Data: data}
		}
	} else if err := httpx.Decode(r, &req, maxShareMeta); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	out, err := a.d.Share.Create(r.Context(), req, originals)
	if err != nil {
		failShare(w, err)
		return
	}
	httpx.Write(w, http.StatusCreated, out)
}

func (a *API) listShares(w http.ResponseWriter, r *http.Request) {
	if !a.shareReady(w) {
		return
	}
	list, err := a.d.Share.List(r.Context())
	if err != nil {
		failShare(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, map[string]any{"shares": list})
}

func (a *API) revokeShare(w http.ResponseWriter, r *http.Request) {
	if !a.shareReady(w) {
		return
	}
	if err := a.d.Share.Revoke(r.Context(), r.PathValue("id")); err != nil {
		failShare(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, map[string]bool{"ok": true})
}
