package server_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/AutumnsGrove/pixelsort-go/server"
	"github.com/AutumnsGrove/pixelsort-go/server/runs"
)

type site struct {
	t   testing.TB
	ts  *httptest.Server
	app *server.App
}

func newSite(t testing.TB, mutate func(*server.Config)) *site {
	t.Helper()
	cfg, err := server.LoadConfig(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	cfg.DataDir = t.TempDir()
	cfg.MaxUploadMB = 5
	if mutate != nil {
		mutate(&cfg)
	}
	web := fstest.MapFS{
		"index.html":                 {Data: []byte("<!doctype html><title>app</title>")},
		"engine.wasm":                {Data: []byte("\x00asm")},
		"_app/immutable/chunks/a.js": {Data: []byte("export {}")},
	}
	app, err := server.New(context.Background(), cfg, server.Options{WebFS: web})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(app.Handler())
	t.Cleanup(func() { ts.Close(); _ = app.Close() })
	return &site{t: t, ts: ts, app: app}
}

func tinyPNG(n int) ([]byte, string) {
	g := image.NewGray(image.Rect(0, 0, 4, 4))
	g.Pix[0], g.Pix[1] = uint8(n), uint8(n>>8)
	var b bytes.Buffer
	if err := png.Encode(&b, g); err != nil {
		panic(err)
	}
	s := sha256.Sum256(b.Bytes())
	return b.Bytes(), hex.EncodeToString(s[:])
}

func (s *site) do(method, path string, body any) (*http.Response, []byte) {
	s.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, s.ts.URL+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close() //nolint:errcheck // test
	out, _ := io.ReadAll(res.Body)
	return res, out
}

func (s *site) expect(res *http.Response, body []byte, status int) {
	s.t.Helper()
	if res.StatusCode != status {
		s.t.Fatalf("status %d, want %d: %s", res.StatusCode, status, body)
	}
}

type created struct {
	ID       int64 `json:"id"`
	Original struct {
		SHA256 string `json:"sha256"`
	} `json:"original"`
	Result struct {
		SHA256 string `json:"sha256"`
	} `json:"result"`
	Starred bool    `json:"starred"`
	Title   *string `json:"title"`
}

func (s *site) upload(orig, res, thumb int, seed int, omitOriginal bool) (*http.Response, []byte) {
	s.t.Helper()
	return s.uploadLook(orig, res, thumb, seed, omitOriginal, map[string]any{"mode": "random", "angle": 45}, nil)
}

// uploadLook is upload with the settings object and parent run of the caller's choice.
func (s *site) uploadLook(orig, res, thumb int, seed int, omitOriginal bool, settings map[string]any, parent *int64) (*http.Response, []byte) {
	s.t.Helper()
	ob, osha := tinyPNG(orig)
	rb, rs := tinyPNG(res)
	tb, ts := tinyPNG(thumb)
	meta := map[string]any{"settings": settings, "seed": seed, "engine_version": "1", "duration_ms": 12, "parent_run_id": parent,
		"original": map[string]any{"sha256": osha, "mime": "image/png", "w": 4, "h": 4},
		"result":   map[string]any{"sha256": rs, "mime": "image/png", "w": 4, "h": 4},
		"thumb":    map[string]any{"sha256": ts, "mime": "image/png", "w": 4, "h": 4}}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	mj, _ := json.Marshal(meta)
	_ = mw.WriteField("meta", string(mj))
	file := func(name string, data []byte) {
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", fmt.Sprintf(`form-data; name=%q; filename=%q`, name, name+".png"))
		h.Set("Content-Type", "image/png")
		w, _ := mw.CreatePart(h)
		_, _ = w.Write(data)
	}
	if !omitOriginal {
		file("original", ob)
	}
	file("result", rb)
	file("thumb", tb)
	_ = mw.Close()
	req, _ := http.NewRequest("POST", s.ts.URL+"/api/runs", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer r.Body.Close() //nolint:errcheck // test
	out, _ := io.ReadAll(r.Body)
	return r, out
}

// The whole life of a run, over real HTTP and real SQLite.
func TestIntegrationRunLifecycle(t *testing.T) {
	s := newSite(t, nil)

	res, body := s.do("GET", "/healthz", nil)
	s.expect(res, body, 200)
	if !strings.Contains(string(body), `"status":"ok"`) {
		t.Fatal(string(body))
	}

	res, body = s.upload(1, 2, 3, 7, false)
	s.expect(res, body, 201)
	var run created
	if err := json.Unmarshal(body, &run); err != nil || run.ID == 0 {
		t.Fatalf("%s %v", body, err)
	}

	res, body = s.do("GET", "/api/runs", nil)
	s.expect(res, body, 200)
	if !strings.Contains(string(body), fmt.Sprintf(`"id":%d`, run.ID)) {
		t.Fatal(string(body))
	}
	for _, sha := range []string{run.Original.SHA256, run.Result.SHA256} {
		res, body = s.do("GET", "/api/images/"+sha, nil)
		s.expect(res, body, 200)
		if res.Header.Get("Content-Type") != "image/png" || len(body) == 0 {
			t.Fatalf("image %s: %v", sha, res.Header)
		}
	}

	// the same upload again is the same run
	res, body = s.upload(1, 2, 3, 7, true)
	s.expect(res, body, 200)

	res, body = s.do("PATCH", fmt.Sprintf("/api/runs/%d", run.ID), map[string]any{"starred": true, "title": "  My   sort "})
	s.expect(res, body, 200)
	_ = json.Unmarshal(body, &run)
	if !run.Starred || run.Title == nil || *run.Title != "My sort" {
		t.Fatalf("%s", body)
	}

	// starred needs confirmation
	res, body = s.do("POST", "/api/runs/trash", map[string]any{"ids": []int64{run.ID}})
	s.expect(res, body, 409)
	if !strings.Contains(string(body), "starred_needs_confirm") || !strings.Contains(string(body), fmt.Sprint(run.ID)) {
		t.Fatal(string(body))
	}
	res, body = s.do("POST", "/api/runs/trash", map[string]any{"ids": []int64{run.ID}, "confirm_starred": true})
	s.expect(res, body, 200)
	_, body = s.do("GET", "/api/runs", nil)
	if strings.Contains(string(body), fmt.Sprintf(`"id":%d`, run.ID)) {
		t.Fatal("a trashed run is still listed")
	}
	res, body = s.do("POST", "/api/runs/restore", map[string]any{"ids": []int64{run.ID}})
	s.expect(res, body, 200)
	res, body = s.do("POST", "/api/runs/trash", map[string]any{"ids": []int64{run.ID}, "confirm_starred": true})
	s.expect(res, body, 200)

	res, body = s.do("GET", "/api/usage", nil)
	s.expect(res, body, 200)
	var u struct{ UsedBytes, TrashBytes, TrashRuns int64 }
	var raw map[string]int64
	_ = json.Unmarshal(body, &raw)
	u.UsedBytes, u.TrashBytes, u.TrashRuns = raw["used_bytes"], raw["trash_bytes"], raw["trash_runs"]
	if u.UsedBytes == 0 || u.TrashBytes != u.UsedBytes || u.TrashRuns != 1 {
		t.Fatalf("usage %s", body)
	}

	res, body = s.do("POST", "/api/trash/empty", nil)
	s.expect(res, body, 200)
	_, body = s.do("GET", "/api/usage", nil)
	_ = json.Unmarshal(body, &raw)
	if raw["used_bytes"] != 0 {
		t.Fatalf("usage after empty: %s", body)
	}
	res, body = s.do("GET", fmt.Sprintf("/api/runs/%d", run.ID), nil)
	s.expect(res, body, 404)
	res, body = s.do("GET", "/api/images/"+run.Result.SHA256, nil)
	s.expect(res, body, 404) // the file went with the run
}

func TestUploadErrors(t *testing.T) {
	s := newSite(t, nil)
	res, body := s.upload(1, 2, 3, 7, true) // original unknown, no part
	s.expect(res, body, 400)
	// body over the limit
	big := bytes.Repeat([]byte{0}, 6<<20)
	req, _ := http.NewRequest("POST", s.ts.URL+"/api/runs", bytes.NewReader(big))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close() //nolint:errcheck,gosec // test
	if r.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize: %d", r.StatusCode)
	}
	// not multipart
	res, body = s.do("POST", "/api/runs", map[string]any{"a": 1})
	s.expect(res, body, 400)
	// non-image result
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_, osha := tinyPNG(1)
	notImg := []byte("this is not an image")
	ns := sha256.Sum256(notImg)
	nh := hex.EncodeToString(ns[:])
	meta := fmt.Sprintf(`{"settings":{},"seed":1,"engine_version":"1","original":{"sha256":%q},"result":{"sha256":%q},"thumb":{"sha256":%q}}`, osha, nh, nh)
	_ = mw.WriteField("meta", meta)
	for _, name := range []string{"original", "result", "thumb"} {
		w, _ := mw.CreateFormFile(name, name)
		if name == "original" {
			ob, _ := tinyPNG(1)
			_, _ = w.Write(ob)
		} else {
			_, _ = w.Write(notImg)
		}
	}
	_ = mw.Close()
	req, _ = http.NewRequest("POST", s.ts.URL+"/api/runs", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	r, _ = http.DefaultClient.Do(req)
	out, _ := io.ReadAll(r.Body)
	r.Body.Close() //nolint:errcheck,gosec // test
	if r.StatusCode != 400 || !strings.Contains(string(out), "bad_type") {
		t.Fatalf("non-image: %d %s", r.StatusCode, out)
	}
}

func TestImageServing(t *testing.T) {
	s := newSite(t, nil)
	_, body := s.upload(1, 2, 3, 7, false)
	var run created
	_ = json.Unmarshal(body, &run)
	url := s.ts.URL + "/api/images/" + run.Result.SHA256

	res, _ := http.Get(url) //nolint:gosec,noctx // test server
	res.Body.Close()        //nolint:errcheck,gosec // test
	h := res.Header
	if h.Get("ETag") != `"`+run.Result.SHA256+`"` || !strings.Contains(h.Get("Cache-Control"), "immutable") ||
		h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Content-Disposition") != "inline" {
		t.Fatalf("headers %v", h)
	}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Range", "bytes=0-9")
	res, _ = http.DefaultClient.Do(req)
	part, _ := io.ReadAll(res.Body)
	res.Body.Close() //nolint:errcheck,gosec // test
	if res.StatusCode != 206 || len(part) != 10 {
		t.Fatalf("range: %d %d bytes", res.StatusCode, len(part))
	}
	req, _ = http.NewRequest("GET", url, nil)
	req.Header.Set("If-None-Match", h.Get("ETag"))
	res, _ = http.DefaultClient.Do(req)
	res.Body.Close() //nolint:errcheck,gosec // test
	if res.StatusCode != 304 {
		t.Fatalf("etag: %d", res.StatusCode)
	}
	for _, bad := range []string{"nope", strings.Repeat("A", 64), "..%2f..%2fetc%2fpasswd", strings.Repeat("a", 64)} {
		res, body := s.do("GET", "/api/images/"+bad, nil)
		s.expect(res, body, 404)
	}
}

func TestSPAAndHeaders(t *testing.T) {
	s := newSite(t, nil)
	res, body := s.do("GET", "/studio", nil)
	s.expect(res, body, 200)
	if !strings.Contains(string(body), "<title>app</title>") || res.Header.Get("Cache-Control") != "no-cache" {
		t.Fatalf("fallback: %s %v", body, res.Header)
	}
	for _, p := range []string{"/api/nope", "/_app/missing.js", "/missing.png"} {
		res, body = s.do("GET", p, nil)
		s.expect(res, body, 404)
	}
	res, _ = s.do("GET", "/engine.wasm", nil)
	if res.Header.Get("Content-Type") != "application/wasm" {
		t.Fatalf("wasm type %q", res.Header.Get("Content-Type"))
	}
	res, _ = s.do("GET", "/_app/immutable/chunks/a.js", nil)
	if !strings.Contains(res.Header.Get("Cache-Control"), "immutable") {
		t.Fatalf("asset cache %q", res.Header.Get("Cache-Control"))
	}
	for _, p := range []string{"/", "/api/version", "/healthz"} {
		res, _ = s.do("GET", p, nil)
		h := res.Header
		csp := h.Get("Content-Security-Policy")
		for _, want := range []string{"default-src 'self'", "'wasm-unsafe-eval'", "frame-ancestors 'none'", "object-src 'none'", "worker-src 'self' blob:"} {
			if !strings.Contains(csp, want) {
				t.Errorf("%s: CSP lacks %q", p, want)
			}
		}
		if h.Get("Cross-Origin-Opener-Policy") != "same-origin" || h.Get("Cross-Origin-Embedder-Policy") != "require-corp" ||
			h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Referrer-Policy") != "no-referrer" {
			t.Errorf("%s: headers %v", p, h)
		}
	}
	_, body = s.do("GET", "/api/version", nil)
	if !strings.Contains(string(body), `"deployment":"dev"`) || !strings.Contains(string(body), `"engine_version"`) {
		t.Fatal(string(body))
	}
}

func TestPresetsSettingsShapesOverHTTP(t *testing.T) {
	s := newSite(t, nil)
	res, body := s.do("POST", "/api/presets", map[string]any{"name": "Rain", "settings": map[string]any{"mode": "wave", "angle": 30}})
	s.expect(res, body, 201)
	var p struct{ ID int64 }
	_ = json.Unmarshal(body, &p)
	res, body = s.do("POST", "/api/presets", map[string]any{"name": "rain", "settings": map[string]any{}})
	s.expect(res, body, 409)
	res, body = s.do("POST", "/api/presets", map[string]any{"name": "Bad", "settings": map[string]any{"mood": "angry"}})
	s.expect(res, body, 400)
	res, body = s.do("GET", "/api/presets", nil)
	s.expect(res, body, 200)
	res, body = s.do("DELETE", fmt.Sprintf("/api/presets/%d", p.ID), nil)
	s.expect(res, body, 204)

	res, body = s.do("PUT", "/api/settings", map[string]any{"exportFormat": "webp", "exportQuality": 80, "grain": false, "workRes": nil})
	s.expect(res, body, 200)
	_, body = s.do("GET", "/api/settings", nil)
	if !strings.Contains(string(body), `"exportFormat":"webp"`) {
		t.Fatal(string(body))
	}
	for _, bad := range []map[string]any{{"evil": 1}, {"exportQuality": 500}, {"exportFormat": "bmp"}, {"workRes": 1000}, {"grain": "yes"}} {
		res, body = s.do("PUT", "/api/settings", bad)
		s.expect(res, body, 400)
	}

	res, body = s.do("POST", "/api/shapes", map[string]any{"name": "Tri", "poly": [][]float64{{0, 0}, {1, 0}, {0.5, 1}}})
	s.expect(res, body, 201)
	var sh struct{ ID int64 }
	_ = json.Unmarshal(body, &sh)
	res, body = s.do("POST", "/api/shapes", map[string]any{"name": "NaN", "poly": [][]any{{"NaN", 0}, {1, 0}, {0.5, 1}}})
	s.expect(res, body, 400)
	many := make([][]float64, 2001)
	for i := range many {
		many[i] = []float64{0.1, 0.2}
	}
	res, body = s.do("POST", "/api/shapes", map[string]any{"name": "Big", "poly": many})
	s.expect(res, body, 400)
	res, body = s.do("POST", "/api/shapes", map[string]any{"name": "Two", "poly": [][]float64{{0, 0}, {1, 1}}})
	s.expect(res, body, 400)
	res, body = s.do("DELETE", fmt.Sprintf("/api/shapes/%d", sh.ID), nil)
	s.expect(res, body, 204)
}

func TestListErrorsAreClientErrors(t *testing.T) {
	s := newSite(t, nil)
	for _, q := range []string{"cursor=!!", "limit=-1", "limit=abc", "sort=weird", "trashed=maybe", "cursor=" + strings.Repeat("A", 5000)} {
		res, body := s.do("GET", "/api/runs?"+q, nil)
		if res.StatusCode != 400 {
			t.Errorf("%s: %d %s", q, res.StatusCode, body)
		}
	}
	res, body := s.do("PATCH", "/api/runs/1", map[string]any{"nonsense": 1})
	s.expect(res, body, 400)
	res, body = s.do("PATCH", "/api/runs/999", map[string]any{"starred": true})
	s.expect(res, body, 404)
	res, body = s.do("GET", "/api/runs/abc", nil)
	s.expect(res, body, 404)
	res, body = s.do("POST", "/api/images/check", map[string]any{"sha256": "short"})
	s.expect(res, body, 400)
}

func TestMutatingRoutesRejectWrongMethods(t *testing.T) {
	s := newSite(t, nil)
	res, _ := s.do("DELETE", "/api/runs", nil)
	if res.StatusCode != 405 && res.StatusCode != 404 {
		t.Fatalf("status %d", res.StatusCode)
	}
}

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil))) // the access log is noise in test output
	os.Exit(m.Run())
}

// FuzzRunsQuery: any query string is either served or refused as a client error, never a 500.
func FuzzRunsQuery(f *testing.F) {
	f.Add("q=wave&limit=5")
	f.Add("cursor=eyJ2IjoxfQ&sort=size")
	f.Add("trashed=any&starred=1&q=%25_%5C")
	f.Add("limit=99999999999999999999")
	s := newSite(f, nil)
	f.Fuzz(func(t *testing.T, query string) {
		req, err := http.NewRequest("GET", s.ts.URL+"/api/runs", nil)
		if err != nil {
			t.Skip()
		}
		req.URL.RawQuery = query
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Skip()
		}
		_ = res.Body.Close()
		if res.StatusCode >= 500 {
			t.Fatalf("query %q gave %d", query, res.StatusCode)
		}
	})
}

// FuzzImageUpload: random multipart bodies and meta text never panic, never 500, and never leave a partial run.
func FuzzImageUpload(f *testing.F) {
	ob, osha := tinyPNG(1)
	f.Add(`{"settings":{},"seed":1,"engine_version":"1"}`, ob, "x")
	f.Add("{", []byte("junk"), "")
	f.Add(fmt.Sprintf(`{"settings":{},"engine_version":"1","original":{"sha256":%q}}`, osha), ob, osha)
	s := newSite(f, nil)
	f.Fuzz(func(t *testing.T, meta string, file []byte, name string) {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		_ = mw.WriteField("meta", meta)
		for _, part := range []string{"original", "result", "thumb"} {
			if w, err := mw.CreateFormFile(part, name); err == nil {
				_, _ = w.Write(file)
			}
		}
		_ = mw.Close()
		req, _ := http.NewRequest("POST", s.ts.URL+"/api/runs", &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Skip()
		}
		_ = res.Body.Close()
		if res.StatusCode >= 500 {
			t.Fatalf("meta %q gave %d", meta, res.StatusCode)
		}
		if res.StatusCode >= 400 {
			page, _ := s.app.Runs().List(context.Background(), runs.ListQuery{Trashed: "any"})
			for _, r := range page.Runs {
				if r.Original.SHA256 == "" {
					t.Fatalf("partial run %+v", r)
				}
			}
		}
	})
}

// A run keeps the whole look (cells, region cards, protected areas and brush strokes) inside its free-form settings, so a
// heavily painted mask must fit, and a run branched from another names its parent.
func TestIntegrationRunKeepsTheWholeLook(t *testing.T) {
	s := newSite(t, nil)
	res, body := s.upload(1, 2, 3, 7, false)
	s.expect(res, body, 201)
	var parent created
	if err := json.Unmarshal(body, &parent); err != nil {
		t.Fatal(err)
	}

	strokes := make([]any, 0, 60)
	for i := 0; i < 60; i++ {
		pts := make([]any, 0, 400)
		for j := 0; j < 400; j++ {
			pts = append(pts, []float64{float64(j) / 400, float64(i) / 60})
		}
		strokes = append(strokes, map[string]any{"radius": 0.02, "points": pts})
	}
	settings := map[string]any{"mode": "wave", "angle": 12,
		"regions": map[string]any{"tiling": map[string]any{"shape": "hexagon", "size": 90, "gap": 6, "rotate": 0, "seed": 7, "pattern": "checker", "kinds": 3}},
		"mask":    map[string]any{"objects": []any{}, "strokes": strokes, "invert": false, "feather": 3}}
	if n := len(mustJSON(t, settings)); n < 300<<10 {
		t.Fatalf("the test's settings are only %d bytes; it must be bigger than the old 256 KiB limit to mean anything", n)
	}
	res, body = s.uploadLook(4, 5, 6, 8, false, settings, &parent.ID)
	s.expect(res, body, 201)
	var child struct {
		ID          int64           `json:"id"`
		ParentRunID *int64          `json:"parent_run_id"`
		Settings    json.RawMessage `json:"settings"`
	}
	if err := json.Unmarshal(body, &child); err != nil {
		t.Fatal(err)
	}
	if child.ParentRunID == nil || *child.ParentRunID != parent.ID {
		t.Fatalf("parent_run_id = %v, want %d", child.ParentRunID, parent.ID)
	}
	var back map[string]json.RawMessage
	if err := json.Unmarshal(child.Settings, &back); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"regions", "mask", "mode", "angle"} {
		if _, ok := back[k]; !ok {
			t.Errorf("settings lost %q on the way back", k)
		}
	}

	// the parent is untouched, and a parent that does not exist is refused
	res, body = s.do("GET", fmt.Sprintf("/api/runs/%d", parent.ID), nil)
	s.expect(res, body, 200)
	if strings.Contains(string(body), `"mask"`) {
		t.Fatal("the opened run must never be changed by a branch")
	}
	missing := int64(999999)
	res, body = s.uploadLook(7, 8, 9, 9, false, map[string]any{"mode": "random"}, &missing)
	s.expect(res, body, 400)
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
