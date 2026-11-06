package server_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server"
	"github.com/AutumnsGrove/pixelsort-go/server/share"
)

const workerSecret = "s3cr3t-value-for-tests-only"

// fakeWorker stands in for the Cloudflare Worker: it checks every signature the way the real one does and keeps what it is sent.
type fakeWorker struct {
	t       *testing.T
	srv     *httptest.Server
	mu      sync.Mutex
	order   []string          // "PUT /api/albums/x/images/0" in arrival order
	objects map[string][]byte // path -> body
	deletes []string
	failPut func(path string) int // non-zero status to answer instead
	failDel int                   // non-zero status for DELETE
	fetch   func(w http.ResponseWriter, r *http.Request)
	badSigs int
}

func newFakeWorker(t *testing.T) *fakeWorker {
	f := &fakeWorker{t: t, objects: map[string][]byte{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeWorker) serve(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	path := r.URL.EscapedPath()
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	ts := r.Header.Get(share.HeaderTimestamp)
	sha := r.Header.Get(share.HeaderBodySHA)
	secs, _ := strconv.ParseInt(ts, 10, 64)
	f.mu.Lock()
	defer f.mu.Unlock()
	ok := share.Signature(workerSecret, r.Method, path, ts, sha) == r.Header.Get(share.HeaderSignature) &&
		share.BodySHA(body) == sha && time.Since(time.Unix(secs, 0)) < 300*time.Second
	if !ok {
		f.badSigs++
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	f.order = append(f.order, r.Method+" "+r.URL.Path)
	switch {
	case r.Method == http.MethodPut:
		if f.failPut != nil {
			if st := f.failPut(r.URL.Path); st != 0 {
				w.WriteHeader(st)
				return
			}
		}
		f.objects[r.URL.Path] = body
		_, _ = w.Write([]byte(`{"ok":true}`))
	case r.Method == http.MethodDelete:
		f.deletes = append(f.deletes, r.URL.Path)
		if f.failDel != 0 {
			w.WriteHeader(f.failDel)
			return
		}
		prefix := r.URL.Path + "/"
		for k := range f.objects {
			if strings.HasPrefix(k, prefix) {
				delete(f.objects, k)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	case r.URL.Path == "/fetch":
		if f.fetch != nil {
			f.fetch(w, r)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}
}

func (f *fakeWorker) count(prefix string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for k := range f.objects {
		if strings.HasPrefix(k, prefix) {
			n++
		}
	}
	return n
}

func withWorker(f *fakeWorker) func(*server.Config) {
	return func(c *server.Config) { c.WorkerURL, c.WorkerSecret = f.srv.URL, workerSecret }
}

func (s *site) twoRuns() []int64 {
	var ids []int64
	for i := 0; i < 2; i++ {
		res, body := s.upload(10+i, 20+i, 30+i, i+1, false)
		s.expect(res, body, http.StatusCreated)
		var c created
		_ = json.Unmarshal(body, &c)
		ids = append(ids, c.ID)
	}
	return ids
}

type shareOut struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	ExpiresAt *int64 `json:"expires_at"`
}

func TestShareUnconfiguredIsAll503(t *testing.T) {
	s := newSite(t, nil)
	res, body := s.do("GET", "/api/features", nil)
	s.expect(res, body, 200)
	if strings.TrimSpace(string(body)) != `{"fetch":false,"helper":false,"share":false}` {
		t.Fatalf("features: %s", body)
	}
	for _, c := range [][2]string{{"POST", "/api/shares"}, {"GET", "/api/shares"}, {"DELETE", "/api/shares/x"}, {"POST", "/api/fetch"}} {
		res, body := s.do(c[0], c[1], map[string]any{})
		if res.StatusCode != 503 || !strings.Contains(string(body), "not_configured") {
			t.Errorf("%s %s: %d %s", c[0], c[1], res.StatusCode, body)
		}
	}
}

func TestShareCreateUploadsSignedAlbumManifestLast(t *testing.T) {
	f := newFakeWorker(t)
	s := newSite(t, withWorker(f))
	ids := s.twoRuns()
	res, body := s.do("POST", "/api/shares", map[string]any{"run_ids": ids, "include_recipe": true, "title": "  Sunsets  ", "expires_in_days": 30})
	s.expect(res, body, 201)
	var out shareOut
	_ = json.Unmarshal(body, &out)
	if len(out.ID) != 26 || out.URL != f.srv.URL+"/a/"+out.ID || out.ExpiresAt == nil {
		t.Fatalf("created: %s", body)
	}
	if f.badSigs != 0 {
		t.Fatalf("%d requests failed signature or body-hash checks", f.badSigs)
	}
	base := "/api/albums/" + out.ID
	if got := f.count(base + "/images/"); got != 2 {
		t.Errorf("images %d", got)
	}
	if got := f.count(base + "/thumbs/"); got != 2 {
		t.Errorf("thumbs %d", got)
	}
	if last := f.order[len(f.order)-1]; last != "PUT "+base+"/manifest.json" {
		t.Errorf("manifest must go last, got %q", last)
	}
	var m struct {
		V      int `json:"v"`
		Title  string
		Images []struct {
			Mime   string
			Recipe map[string]any
		}
	}
	_ = json.Unmarshal(f.objects[base+"/manifest.json"], &m)
	if m.V != 1 || m.Title != "Sunsets" || len(m.Images) != 2 || m.Images[0].Recipe["mode"] != "random" {
		t.Errorf("manifest: %s", f.objects[base+"/manifest.json"])
	}
	// the image bytes are the stored result bytes
	want, _ := tinyPNG(20)
	if !bytes.Equal(f.objects[base+"/images/0"], want) {
		t.Error("image 0 is not the stored result")
	}

	// listing, and the run reports it is shared
	res, body = s.do("GET", "/api/shares", nil)
	s.expect(res, body, 200)
	if !strings.Contains(string(body), `"items":2`) {
		t.Errorf("list: %s", body)
	}
	res, body = s.do("GET", fmt.Sprintf("/api/runs/%d", ids[0]), nil)
	s.expect(res, body, 200)
	if !strings.Contains(string(body), `"shared":true`) {
		t.Errorf("run: %s", body)
	}
}

func TestShareRecipeOnlyWithIncludeRecipe(t *testing.T) {
	f := newFakeWorker(t)
	s := newSite(t, withWorker(f))
	ids := s.twoRuns()
	res, body := s.do("POST", "/api/shares", map[string]any{"run_ids": ids})
	s.expect(res, body, 201)
	var out shareOut
	_ = json.Unmarshal(body, &out)
	if strings.Contains(string(f.objects["/api/albums/"+out.ID+"/manifest.json"]), "recipe") {
		t.Error("the manifest carries a recipe nobody asked to share")
	}
}

func TestShareFailureRevokesPartialAlbumAndLeavesNoRow(t *testing.T) {
	f := newFakeWorker(t)
	f.failPut = func(p string) int {
		if strings.HasSuffix(p, "/images/1") {
			return 400 // not retried
		}
		return 0
	}
	s := newSite(t, withWorker(f))
	ids := s.twoRuns()
	res, body := s.do("POST", "/api/shares", map[string]any{"run_ids": ids})
	s.expect(res, body, 502)
	if len(f.deletes) != 1 {
		t.Errorf("deletes: %v", f.deletes)
	}
	if n := f.count("/api/albums/"); n != 0 {
		t.Errorf("%d objects left on the Worker", n)
	}
	res, body = s.do("GET", "/api/shares", nil)
	s.expect(res, body, 200)
	if !strings.Contains(string(body), `"shares":[]`) {
		t.Errorf("a row was left: %s", body)
	}
}

func TestShareUploadsRetryOnServerError(t *testing.T) {
	f := newFakeWorker(t)
	var tries int
	f.failPut = func(p string) int {
		if strings.HasSuffix(p, "/thumbs/0") && tries < 2 {
			tries++
			return 503
		}
		return 0
	}
	s := newSite(t, withWorker(f))
	ids := s.twoRuns()
	res, body := s.do("POST", "/api/shares", map[string]any{"run_ids": ids[:1]})
	s.expect(res, body, 201)
	if tries != 2 {
		t.Errorf("tries %d", tries)
	}
}

func TestShareRevoke(t *testing.T) {
	f := newFakeWorker(t)
	s := newSite(t, withWorker(f))
	ids := s.twoRuns()
	res, body := s.do("POST", "/api/shares", map[string]any{"run_ids": ids})
	s.expect(res, body, 201)
	var out shareOut
	_ = json.Unmarshal(body, &out)

	f.failDel = 500
	res, body = s.do("DELETE", "/api/shares/"+out.ID, nil)
	s.expect(res, body, 502) // unreachable: the row stays live
	_, body = s.do("GET", "/api/shares", nil)
	if strings.Contains(string(body), `"revoked_at":1`) {
		t.Fatalf("revoked despite the failure: %s", body)
	}
	f.failDel = 0
	res, body = s.do("DELETE", "/api/shares/"+out.ID, nil)
	s.expect(res, body, 200)
	if n := f.count("/api/albums/" + out.ID); n != 0 {
		t.Errorf("%d objects left", n)
	}
	_, body = s.do("GET", "/api/shares", nil)
	var list struct {
		Shares []struct {
			RevokedAt *int64 `json:"revoked_at"`
		}
	}
	_ = json.Unmarshal(body, &list)
	if len(list.Shares) != 1 || list.Shares[0].RevokedAt == nil {
		t.Errorf("not marked: %s", body)
	}
	_, body = s.do("GET", fmt.Sprintf("/api/runs/%d", ids[0]), nil)
	if strings.Contains(string(body), `"shared":true`) {
		t.Error("a revoked share still counts")
	}
	res, body = s.do("DELETE", "/api/shares/"+out.ID, nil) // twice is fine
	s.expect(res, body, 200)
	res, body = s.do("DELETE", "/api/shares/nonexistent", nil)
	s.expect(res, body, 404)
}

func TestShareOriginalsNeverSentAsStored(t *testing.T) {
	f := newFakeWorker(t)
	s := newSite(t, withWorker(f))
	ids := s.twoRuns()
	res, body := s.do("POST", "/api/shares", map[string]any{"run_ids": ids, "include_original": true})
	s.expect(res, body, 400)
	if !strings.Contains(string(body), "originals_required") {
		t.Errorf("body: %s", body)
	}
	if len(f.order) != 0 {
		t.Errorf("something was uploaded: %v", f.order)
	}

	stripped, _ := tinyPNG(99) // what the browser re-encoded
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	meta, _ := json.Marshal(map[string]any{"run_ids": ids[:1], "include_original": true})
	_ = mw.WriteField("meta", string(meta))
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="orig-%d"; filename="o.png"`, ids[0]))
	h.Set("Content-Type", "image/png")
	pw, _ := mw.CreatePart(h)
	_, _ = pw.Write(stripped)
	_ = mw.Close()
	req, _ := http.NewRequest("POST", s.ts.URL+"/api/shares", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	s.expect(r, b, 201)
	var out shareOut
	_ = json.Unmarshal(b, &out)
	base := "/api/albums/" + out.ID
	if !bytes.Equal(f.objects[base+"/images/1"], stripped) {
		t.Error("image 1 is not the browser's stripped original")
	}
	stored, _ := tinyPNG(10)
	if bytes.Equal(f.objects[base+"/images/1"], stored) {
		t.Error("the stored original was uploaded")
	}
}

func TestFetchStreamsAndKeepsErrorCodes(t *testing.T) {
	f := newFakeWorker(t)
	png, _ := tinyPNG(5)
	f.fetch = func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("url") {
		case "https://example.com/a.png":
			w.Header().Set("Content-Type", "image/png")
			w.Header().Set("X-Source-URL", "https://example.com/a.png")
			_, _ = w.Write(png)
		default:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(415)
			_, _ = w.Write([]byte(`{"error":{"code":"link-not-image","message":"x"}}`))
		}
	}
	s := newSite(t, withWorker(f))
	res, body := s.do("POST", "/api/fetch", map[string]any{"url": "https://example.com/a.png"})
	s.expect(res, body, 200)
	if !bytes.Equal(body, png) || res.Header.Get("Content-Type") != "image/png" || res.Header.Get("X-Source-URL") == "" {
		t.Errorf("not streamed through: %d %q", len(body), res.Header)
	}
	res, body = s.do("POST", "/api/fetch", map[string]any{"url": "https://example.com/page"})
	s.expect(res, body, 415)
	if !strings.Contains(string(body), "link-not-image") {
		t.Errorf("code lost: %s", body)
	}
	if f.badSigs != 0 {
		t.Error("bad signature on /fetch")
	}
}

func TestFetchRateLimit(t *testing.T) {
	f := newFakeWorker(t)
	f.fetch = func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(404) }
	s := newSite(t, withWorker(f))
	got429 := -1
	for i := 1; i <= 31; i++ {
		res, _ := s.do("POST", "/api/fetch", map[string]any{"url": "https://example.com/a.png"})
		if res.StatusCode == 429 && got429 < 0 {
			got429 = i
		}
	}
	if got429 != 31 {
		t.Errorf("first 429 at request %d, want 31", got429)
	}
}

func TestWorkerSecretNeverLeaks(t *testing.T) {
	var logs bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(old) })

	f := newFakeWorker(t)
	f.failDel = 500
	s := newSite(t, withWorker(f))
	ids := s.twoRuns()
	var seen []string
	collect := func(res *http.Response, body []byte) {
		seen = append(seen, string(body))
		for k, v := range res.Header {
			seen = append(seen, k+": "+strings.Join(v, ","))
		}
	}
	res, body := s.do("POST", "/api/shares", map[string]any{"run_ids": ids})
	collect(res, body)
	var out shareOut
	_ = json.Unmarshal(body, &out)
	collect(s.do("GET", "/api/shares", nil))
	collect(s.do("DELETE", "/api/shares/"+out.ID, nil)) // fails: logs a warning
	collect(s.do("POST", "/api/fetch", map[string]any{"url": "https://example.com/a.png"}))
	collect(s.do("GET", "/api/features", nil))
	f.srv.Close() // an unreachable Worker produces a transport error
	collect(s.do("DELETE", "/api/shares/"+out.ID, nil))
	for _, x := range append(seen, logs.String()) {
		if strings.Contains(x, workerSecret) {
			t.Fatalf("the secret leaked: %.200s", x)
		}
	}
	if !strings.Contains(logs.String(), "share worker failed") {
		t.Error("expected the failure to be logged")
	}
}

func TestConfigWorker(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	for _, c := range []struct {
		name string
		env  map[string]string
		ok   bool
	}{
		{"neither", map[string]string{}, true},
		{"https", map[string]string{"PIXELSORT_WORKER_URL": "https://w.example.workers.dev/", "PIXELSORT_WORKER_SECRET": "sekrit-9f3a"}, true},
		{"localhost http", map[string]string{"PIXELSORT_WORKER_URL": "http://127.0.0.1:8787", "PIXELSORT_WORKER_SECRET": "sekrit-9f3a"}, true},
		{"url only", map[string]string{"PIXELSORT_WORKER_URL": "https://w.example"}, false},
		{"secret only", map[string]string{"PIXELSORT_WORKER_SECRET": "sekrit-9f3a"}, false},
		{"plain http elsewhere", map[string]string{"PIXELSORT_WORKER_URL": "http://w.example", "PIXELSORT_WORKER_SECRET": "sekrit-9f3a"}, false},
		{"has a path", map[string]string{"PIXELSORT_WORKER_URL": "https://w.example/api", "PIXELSORT_WORKER_SECRET": "sekrit-9f3a"}, false},
		{"credentials", map[string]string{"PIXELSORT_WORKER_URL": "https://u:p@w.example", "PIXELSORT_WORKER_SECRET": "sekrit-9f3a"}, false},
	} {
		cfg, err := server.LoadConfig(env(c.env))
		if (err == nil) != c.ok {
			t.Errorf("%s: err=%v", c.name, err)
		}
		if err == nil && c.name == "https" && cfg.WorkerURL != "https://w.example.workers.dev" {
			t.Errorf("trailing slash kept: %q", cfg.WorkerURL)
		}
		if err != nil && c.env["PIXELSORT_WORKER_SECRET"] != "" && strings.Contains(err.Error(), c.env["PIXELSORT_WORKER_SECRET"]) {
			t.Errorf("error quotes the secret")
		}
	}
}
