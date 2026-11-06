package spa_test

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/AutumnsGrove/pixelsort-go/server/spa"
)

// wasmLike is compressible, like the real engine.wasm (4.7 MB, about 1.3 MB gzipped).
var wasmLike = append([]byte("\x00asm\x01\x00\x00\x00"), bytes.Repeat([]byte("pixelsort engine "), 2000)...)

func site() fstest.MapFS {
	return fstest.MapFS{
		"index.html":                {Data: []byte("<html><body>" + strings.Repeat("hello ", 400) + "</body></html>")},
		"engine.wasm":               {Data: wasmLike},
		"_app/immutable/app.abc.js": {Data: []byte(strings.Repeat("export const x = 1;\n", 200))},
		"logo.png":                  {Data: bytes.Repeat([]byte{0x89, 'P', 'N', 'G'}, 600)},
		"tiny.json":                 {Data: []byte(`{"a":1}`)},
	}
}

func get(t *testing.T, path string, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	spa.Handler(site()).ServeHTTP(rec, req)
	return rec
}

func gunzip(t *testing.T, b []byte) []byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("not gzip: %v", err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	return out
}

func TestWasmIsGzippedWhenAccepted(t *testing.T) {
	rec := get(t, "/engine.wasm", map[string]string{"Accept-Encoding": "gzip, br"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("Content-Encoding %q, want gzip", rec.Header().Get("Content-Encoding"))
	}
	if !strings.Contains(rec.Header().Get("Vary"), "Accept-Encoding") {
		t.Fatalf("Vary %q must name Accept-Encoding", rec.Header().Get("Vary"))
	}
	if rec.Header().Get("Content-Type") != "application/wasm" {
		t.Fatalf("Content-Type %q: streaming compile needs application/wasm", rec.Header().Get("Content-Type"))
	}
	if rec.Body.Len() >= len(wasmLike)/2 {
		t.Fatalf("body is %d bytes for %d raw: not compressed", rec.Body.Len(), len(wasmLike))
	}
	if !bytes.Equal(gunzip(t, rec.Body.Bytes()), wasmLike) {
		t.Fatal("decompressed body differs from the file")
	}
	// net/http leaves Content-Length off a response that has Content-Encoding; the loader wants sizes for progress. A
	// browser hands fetch readers the decoded bytes, so the page needs the decoded size, not only the wire size.
	if got, want := rec.Header().Get("Content-Length"), strconv.Itoa(rec.Body.Len()); got != want {
		t.Fatalf("Content-Length %q, want %q", got, want)
	}
	if got, want := rec.Header().Get("X-Uncompressed-Length"), strconv.Itoa(len(wasmLike)); got != want {
		t.Fatalf("X-Uncompressed-Length %q, want %q", got, want)
	}
}

func TestWasmIsPlainWithoutAcceptEncoding(t *testing.T) {
	for _, ae := range []string{"", "identity", "gzip;q=0", "br"} {
		rec := get(t, "/engine.wasm", map[string]string{"Accept-Encoding": ae})
		if rec.Header().Get("Content-Encoding") != "" {
			t.Errorf("Accept-Encoding %q: got Content-Encoding %q", ae, rec.Header().Get("Content-Encoding"))
		}
		if !bytes.Equal(rec.Body.Bytes(), wasmLike) {
			t.Errorf("Accept-Encoding %q: body is not the raw file", ae)
		}
		if !strings.Contains(rec.Header().Get("Vary"), "Accept-Encoding") {
			t.Errorf("Accept-Encoding %q: Vary %q must still name Accept-Encoding so caches keep both", ae, rec.Header().Get("Vary"))
		}
	}
}

func TestWasmRevalidatesWithAStrongETag(t *testing.T) {
	plain := get(t, "/engine.wasm", nil)
	zipped := get(t, "/engine.wasm", map[string]string{"Accept-Encoding": "gzip"})
	pe, ze := plain.Header().Get("ETag"), zipped.Header().Get("ETag")
	if pe == "" || ze == "" || strings.HasPrefix(pe, "W/") || strings.HasPrefix(ze, "W/") {
		t.Fatalf("want strong ETags, got %q and %q", pe, ze)
	}
	if pe == ze {
		t.Fatalf("the gzip and plain bodies are different representations and need different ETags (both %q)", pe)
	}
	if cc := plain.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("Cache-Control %q: the browser should keep the file but revalidate it (no-cache)", cc)
	}
	// a repeat visit asks "still the same?" and gets a tiny yes
	for _, c := range []struct {
		name, ae, etag string
	}{{"plain", "", pe}, {"gzip", "gzip", ze}} {
		rec := get(t, "/engine.wasm", map[string]string{"Accept-Encoding": c.ae, "If-None-Match": c.etag})
		if rec.Code != http.StatusNotModified {
			t.Errorf("%s: status %d, want 304", c.name, rec.Code)
		}
		if rec.Body.Len() != 0 {
			t.Errorf("%s: a 304 must have no body, got %d bytes", c.name, rec.Body.Len())
		}
		if rec.Header().Get("ETag") != c.etag {
			t.Errorf("%s: 304 ETag %q, want %q", c.name, rec.Header().Get("ETag"), c.etag)
		}
	}
	// a stale or foreign tag gets the full file
	if rec := get(t, "/engine.wasm", map[string]string{"If-None-Match": `"old"`}); rec.Code != http.StatusOK || rec.Body.Len() != len(wasmLike) {
		t.Fatalf("stale tag: status %d, %d bytes", rec.Code, rec.Body.Len())
	}
}

func TestOtherAssetsKeepTheirCachingAndSomeAreCompressed(t *testing.T) {
	js := get(t, "/_app/immutable/app.abc.js", map[string]string{"Accept-Encoding": "gzip"})
	if js.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("hashed assets stay immutable, got %q", js.Header().Get("Cache-Control"))
	}
	if js.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal("text assets are worth compressing too")
	}
	if idx := get(t, "/", nil); idx.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("index.html Cache-Control %q", idx.Header().Get("Cache-Control"))
	}
	png := get(t, "/logo.png", map[string]string{"Accept-Encoding": "gzip"})
	if png.Header().Get("Content-Encoding") != "" || png.Header().Get("Vary") != "" {
		t.Fatalf("images are already compressed: leave them alone (Content-Encoding %q, Vary %q)", png.Header().Get("Content-Encoding"), png.Header().Get("Vary"))
	}
	tiny := get(t, "/tiny.json", map[string]string{"Accept-Encoding": "gzip"})
	if tiny.Header().Get("Content-Encoding") != "" || tiny.Body.String() != `{"a":1}` {
		t.Fatal("a few bytes are not worth compressing")
	}
}

func TestMissingAssetsAndAPIPathsStillFail(t *testing.T) {
	if rec := get(t, "/nope.wasm", map[string]string{"Accept-Encoding": "gzip"}); rec.Code != http.StatusNotFound {
		t.Fatalf("missing file: %d", rec.Code)
	}
	if rec := get(t, "/api/x", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("api path: %d", rec.Code)
	}
	if rec := get(t, "/some/page", nil); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "hello") {
		t.Fatalf("deep link should fall back to index.html: %d", rec.Code)
	}
}
