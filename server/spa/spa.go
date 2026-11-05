// Package spa serves the built web app: static files from an fs.FS, with index.html as the fallback for client-side
// routes, long caching for hashed assets and the right type for WebAssembly.
package spa

import (
	"crypto/sha256"
	"encoding/base64"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"
)

// Handler serves fsys. Unknown paths that look like pages (no file extension, not under /api or /_app) get
// index.html so deep links work; missing assets and API paths get a plain 404.
func Handler(fsys fs.FS) http.Handler {
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := path.Clean("/" + r.URL.Path)
		if p == "/api" || strings.HasPrefix(p, "/api/") {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(p, "/")
		if name == "" {
			name = "index.html"
		}
		if info, err := fs.Stat(fsys, name); err != nil || info.IsDir() {
			if path.Ext(name) != "" || strings.HasPrefix(p, "/_app/") {
				http.NotFound(w, r)
				return
			}
			name = "index.html"
		}
		f, err := fsys.Open(name)
		if err != nil {
			http.Error(w, "the web app is not built into this binary (run make web and build with -tags embedweb)", http.StatusServiceUnavailable)
			return
		}
		defer f.Close() //nolint:errcheck // read-only file
		h := w.Header()
		switch {
		case strings.HasPrefix(p, "/_app/immutable/"):
			h.Set("Cache-Control", "public, max-age=31536000, immutable")
		case name == "index.html":
			h.Set("Cache-Control", "no-cache")
		}
		if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
			h.Set("Content-Type", ct)
		}
		if rs, ok := f.(io.ReadSeeker); ok {
			http.ServeContent(w, r, name, modTime(f), rs)
			return
		}
		_, _ = io.Copy(w, f)
	})
}

func modTime(f fs.File) (t time.Time) {
	if info, err := f.Stat(); err == nil {
		return info.ModTime()
	}
	return
}

var inlineScript = regexp.MustCompile(`(?s)<script>(.*?)</script>`)

// InlineScriptHashes returns CSP source expressions ('sha256-...') for every attribute-free inline <script> in
// index.html, so a Content-Security-Policy can allow SvelteKit's start-up script without 'unsafe-inline'.
func InlineScriptHashes(fsys fs.FS) []string {
	raw, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		return nil
	}
	var out []string
	for _, m := range inlineScript.FindAllSubmatch(raw, -1) {
		sum := sha256.Sum256(m[1])
		out = append(out, "'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'")
	}
	return out
}
