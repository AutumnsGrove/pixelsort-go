package api

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/AutumnsGrove/pixelsort-go/server/httpx"
	"github.com/AutumnsGrove/pixelsort-go/server/runs"
)

const maxMetaBytes = 256 << 10

// createRun handles POST /api/runs: multipart with a JSON "meta" field and the files "original" (optional when the
// server already has it), "result" and "thumb".
func (a *API) createRun(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength > a.d.MaxUploadBytes {
		fail(w, httpx.ErrBodyTooLarge)
		return
	}
	limited := &overflowReader{r: http.MaxBytesReader(w, r.Body, a.d.MaxUploadBytes)}
	r.Body = limited
	// The body is already capped by MaxBytesReader above; the 8 MB is only how much stays in memory before files spill to disk.
	if err := r.ParseMultipartForm(8 << 20); err != nil { //nolint:gosec // G120: bounded by the MaxBytesReader on r.Body
		if limited.exceeded {
			fail(w, httpx.ErrBodyTooLarge) // the multipart package hides the cause, so the reader remembers it
			return
		}
		fail(w, classifyMultipart(err))
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }() // temp files for big uploads
	metaText := r.MultipartForm.Value["meta"]
	if len(metaText) != 1 {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "the request needs exactly one meta field")
		return
	}
	var m runs.Meta
	if err := httpx.DecodeReader(strings.NewReader(metaText[0]), &m, maxMetaBytes); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	open := func(name string) (io.Reader, func(), error) {
		fs := r.MultipartForm.File[name]
		if len(fs) == 0 {
			return nil, func() {}, nil
		}
		if len(fs) > 1 {
			return nil, nil, errors.Join(runs.ErrInvalid, errors.New("one "+name+" file only"))
		}
		f, err := fs[0].Open()
		if err != nil {
			return nil, nil, err //nolint:wrapcheck // reported as a 500 by fail
		}
		return f, func() { _ = f.Close() }, nil
	}
	var parts runs.Parts
	for _, x := range []struct {
		name string
		dst  *io.Reader
	}{{"original", &parts.Original}, {"result", &parts.Result}, {"thumb", &parts.Thumb}} {
		rd, closeFn, err := open(x.name)
		if err != nil {
			fail(w, err)
			return
		}
		defer closeFn()
		*x.dst = rd
	}
	run, created, err := a.d.Runs.Create(r.Context(), m, parts)
	if err != nil {
		fail(w, err)
		return
	}
	status := http.StatusCreated
	if !created {
		status = http.StatusOK
	}
	httpx.Write(w, status, run)
}

// overflowReader notes when the size limit was what stopped the read.
type overflowReader struct {
	r        io.ReadCloser
	exceeded bool
}

func (o *overflowReader) Read(p []byte) (int, error) {
	n, err := o.r.Read(p)
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		o.exceeded = true
	}
	return n, err //nolint:wrapcheck // a pass-through reader must return the underlying error unchanged
}

func (o *overflowReader) Close() error { return o.r.Close() } //nolint:wrapcheck // pass-through

func classifyMultipart(err error) error {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		return err
	}
	return errors.Join(runs.ErrInvalid, errors.New("the body is not valid multipart/form-data"))
}

func (a *API) checkImage(w http.ResponseWriter, r *http.Request) {
	var in struct {
		SHA256 string `json:"sha256"`
	}
	if err := httpx.Decode(r, &in, 4096); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	ok, err := a.d.Runs.ImageExists(r.Context(), in.SHA256)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, map[string]bool{"exists": ok})
}

func pathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

func (a *API) getRun(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "not found")
		return
	}
	run, err := a.d.Runs.Get(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, run)
}

func (a *API) listRuns(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lq := runs.ListQuery{Cursor: q.Get("cursor"), Q: q.Get("q"), Trashed: q.Get("trashed"), Sort: q.Get("sort"), Starred: q.Get("starred") == "1"}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "limit must be a positive whole number")
			return
		}
		lq.Limit = n
	}
	if len(lq.Q) > 200 {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "q is limited to 200 characters")
		return
	}
	page, err := a.d.Runs.List(r.Context(), lq)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, page)
}

func (a *API) patchRun(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "not found")
		return
	}
	var p runs.Patch
	if err := httpx.Decode(r, &p, 64<<10); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	run, err := a.d.Runs.Update(r.Context(), id, p)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, run)
}

type idsBody struct {
	IDs            []int64 `json:"ids"`
	ConfirmStarred bool    `json:"confirm_starred"`
}

func (a *API) trashRuns(w http.ResponseWriter, r *http.Request) {
	var b idsBody
	if err := httpx.Decode(r, &b, 256<<10); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	res, err := a.d.Runs.Trash(r.Context(), b.IDs, b.ConfirmStarred)
	if errors.Is(err, runs.ErrStarredNeedOK) {
		httpx.Write(w, http.StatusConflict, httpx.Envelope{Error: httpx.Detail{Code: httpx.CodeStarredNeedsOK,
			Message: "some of these runs are starred; confirm to trash them", IDs: res.Starred}})
		return
	}
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, map[string]any{"trashed": nonNil(res.Trashed), "missing": nonNil(res.Missing)})
}

func nonNil(v []int64) []int64 {
	if v == nil {
		return []int64{}
	}
	return v
}

func (a *API) restoreRuns(w http.ResponseWriter, r *http.Request) {
	var b idsBody
	if err := httpx.Decode(r, &b, 256<<10); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	if err := a.d.Runs.Restore(r.Context(), b.IDs); err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, map[string]int{"restored": len(b.IDs)})
}

func (a *API) emptyTrash(w http.ResponseWriter, r *http.Request) {
	n, err := a.d.Runs.EmptyTrash(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, map[string]int{"deleted": n})
}

func (a *API) usage(w http.ResponseWriter, r *http.Request) {
	u, err := a.d.Runs.Usage(r.Context(), a.d.BudgetBytes)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, u)
}
