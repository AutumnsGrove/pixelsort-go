package spa

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

var zeroTime time.Time

// minCompressBytes is the size under which gzip costs more than it saves.
const minCompressBytes = 1024

// compressible reports whether a file of this extension shrinks under gzip. Images and fonts are already compressed.
func compressible(ext string) bool {
	switch ext {
	case ".wasm", ".js", ".mjs", ".css", ".html", ".json", ".svg", ".txt", ".map", ".webmanifest":
		return true
	}
	return false
}

// asset is one file of the built web app, read once. The FS is the embedded build (or a test's map), which never
// changes while the process runs, so the bytes, the hash and the gzip copy are computed on first use and kept.
type asset struct {
	raw      []byte
	etag     string // strong validator for the plain bytes
	gzOnce   sync.Once
	gz       []byte
	gzetag   string // a different representation needs a different validator
	canGzip  bool
	loadErr  error
	loadOnce sync.Once
}

type assets struct {
	fsys fs.FS
	m    sync.Map // name -> *asset
}

func (a *assets) get(name string) (*asset, error) {
	v, _ := a.m.LoadOrStore(name, &asset{})
	as := v.(*asset) //nolint:forcetypeassert // only *asset is ever stored
	as.loadOnce.Do(func() {
		as.raw, as.loadErr = fs.ReadFile(a.fsys, name)
		if as.loadErr != nil {
			return
		}
		sum := sha256.Sum256(as.raw)
		h := hex.EncodeToString(sum[:16])
		as.etag = `"` + h + `"`
		as.gzetag = `"` + h + `-gzip"`
		as.canGzip = compressible(path.Ext(name)) && len(as.raw) >= minCompressBytes
	})
	return as, as.loadErr
}

// gzipped returns the compressed copy, made once. A copy that is not smaller is not used.
func (as *asset) gzipped() []byte {
	as.gzOnce.Do(func() {
		var buf bytes.Buffer
		zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		if err != nil {
			return // a valid constant level cannot fail; the plain copy is served
		}
		if _, err := zw.Write(as.raw); err != nil {
			return
		}
		if err := zw.Close(); err != nil {
			return
		}
		if buf.Len() < len(as.raw) {
			as.gz = buf.Bytes()
		}
	})
	return as.gz
}

// acceptsGzip reads Accept-Encoding: gzip counts unless it has q=0. A bare "*" is not treated as a yes, so a client
// that only said "br" or "identity" gets the plain bytes.
func acceptsGzip(h string) bool {
	for _, part := range strings.Split(h, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		if strings.ToLower(strings.TrimSpace(fields[0])) != "gzip" {
			continue
		}
		for _, p := range fields[1:] {
			k, v, ok := strings.Cut(strings.TrimSpace(p), "=")
			if ok && strings.EqualFold(strings.TrimSpace(k), "q") {
				if q, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil && q <= 0 {
					return false
				}
			}
		}
		return true
	}
	return false
}

// serveAsset writes one file with its validators. The caller has already chosen the cache policy in w's headers.
func serveAsset(w http.ResponseWriter, r *http.Request, name string, as *asset) {
	h := w.Header()
	if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
		h.Set("Content-Type", ct)
	}
	body, tag := as.raw, as.etag
	if as.canGzip {
		// Say so even when this client gets the plain bytes, so a shared cache keeps one copy per encoding.
		h.Add("Vary", "Accept-Encoding")
		if acceptsGzip(r.Header.Get("Accept-Encoding")) {
			if gz := as.gzipped(); gz != nil {
				body, tag = gz, as.gzetag
				h.Set("Content-Encoding", "gzip")
				// net/http leaves Content-Length off a response that has Content-Encoding. Send it, and the decoded
				// size too: a browser's fetch reader sees decoded bytes, so progress is counted against that.
				h.Set("Content-Length", strconv.Itoa(len(gz)))
				h.Set("X-Uncompressed-Length", strconv.Itoa(len(as.raw)))
				r.Header.Del("Range") // a byte range of a gzip body is not what a browser means
			}
		}
	}
	h.Set("ETag", tag)
	// ServeContent answers If-None-Match with 304 (and ranges for plain bodies); a zero time sends no Last-Modified.
	http.ServeContent(w, r, name, zeroTime, bytes.NewReader(body))
}
