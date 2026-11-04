// Package blob is a content-addressed file store for images. Paths are only ever built from a validated SHA-256, so
// nothing a client sends can name a path (traversal is impossible by construction).
package blob

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// Errors a caller can test with errors.Is.
var (
	ErrTooLarge     = errors.New("blob: too large")
	ErrBadType      = errors.New("blob: not an allowed image type")
	ErrHashMismatch = errors.New("blob: content does not match the declared hash")
	ErrBadSHA       = errors.New("blob: bad sha256")
	ErrNotFound     = errors.New("blob: not found")
)

// Blob describes a stored file.
type Blob struct {
	SHA  string
	Size int64
	Mime string
	Ext  string
}

var allowed = map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}

// Store keeps files under root/images/ab/abcdef...<ext>.
type Store struct {
	root     string
	maxBytes int64
	mu       sync.Mutex // serialises the final rename so concurrent identical Puts leave exactly one file
}

// New creates the store's directory (0700) and returns it.
func New(root string, maxBytes int64) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(root, "images"), 0o700); err != nil {
		return nil, fmt.Errorf("blob: create %s: %w", root, err)
	}
	return &Store{root: root, maxBytes: maxBytes}, nil
}

// ValidSHA reports whether s is exactly 64 lowercase hex characters.
func ValidSHA(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

func (s *Store) dir(sha string) string { return filepath.Join(s.root, "images", sha[:2]) }

// find returns the path of the stored file for sha, whatever its extension.
func (s *Store) find(sha string) (string, string, bool) {
	for mime, ext := range allowed {
		p := filepath.Join(s.dir(sha), sha+ext)
		if _, err := os.Stat(p); err == nil {
			return p, mime, true
		}
	}
	return "", "", false
}

// Put streams r into the store while hashing it. If declaredSHA is not empty it must match. The type is read from the
// content, not trusted from the client.
func (s *Store) Put(ctx context.Context, r io.Reader, declaredSHA string) (Blob, error) {
	if declaredSHA != "" && !ValidSHA(declaredSHA) {
		return Blob{}, ErrBadSHA
	}
	tmpDir := filepath.Join(s.root, "images", ".tmp")
	if err := os.MkdirAll(tmpDir, 0o700); err != nil {
		return Blob{}, fmt.Errorf("blob: temp dir: %w", err)
	}
	tmp, err := os.CreateTemp(tmpDir, "put-*")
	if err != nil {
		return Blob{}, fmt.Errorf("blob: temp file: %w", err)
	}
	keep := false
	defer func() {
		_ = tmp.Close()
		if !keep {
			_ = os.Remove(tmp.Name())
		}
	}()

	h := sha256.New()
	var head [512]byte
	n, err := io.ReadFull(io.TeeReader(io.LimitReader(contextReader{ctx, r}, s.maxBytes+1), io.MultiWriter(tmp, h)), head[:])
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		return Blob{}, fmt.Errorf("blob: read: %w", err)
	}
	mime := http.DetectContentType(head[:n])
	ext, ok := allowed[mime]
	if !ok {
		return Blob{}, ErrBadType
	}
	written := int64(n)
	if n == len(head) {
		m, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(contextReader{ctx, r}, s.maxBytes+1-int64(n)))
		if err != nil {
			return Blob{}, fmt.Errorf("blob: read: %w", err)
		}
		written += m
	}
	if written > s.maxBytes {
		return Blob{}, ErrTooLarge
	}
	sha := hex.EncodeToString(h.Sum(nil))
	if declaredSHA != "" && declaredSHA != sha {
		return Blob{}, ErrHashMismatch
	}
	if err := tmp.Close(); err != nil {
		return Blob{}, fmt.Errorf("blob: close temp: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, _, exists := s.find(sha); exists {
		return Blob{SHA: sha, Size: written, Mime: mime, Ext: ext}, nil // deduplicated: the temp file is discarded
	}
	if err := os.MkdirAll(s.dir(sha), 0o700); err != nil {
		return Blob{}, fmt.Errorf("blob: create dir: %w", err)
	}
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		return Blob{}, fmt.Errorf("blob: chmod: %w", err)
	}
	if err := os.Rename(tmp.Name(), filepath.Join(s.dir(sha), sha+ext)); err != nil {
		return Blob{}, fmt.Errorf("blob: store: %w", err)
	}
	keep = true
	return Blob{SHA: sha, Size: written, Mime: mime, Ext: ext}, nil
}

// contextReader stops reading when the context ends (a client that hangs up mid-upload).
type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (c contextReader) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.Read(p)
}

// Open returns the stored file for sha.
func (s *Store) Open(sha string) (*os.File, Blob, error) {
	if !ValidSHA(sha) {
		return nil, Blob{}, ErrBadSHA
	}
	p, mime, ok := s.find(sha)
	if !ok {
		return nil, Blob{}, ErrNotFound
	}
	f, err := os.Open(p) //nolint:gosec // p is built from a validated sha and a fixed extension
	if err != nil {
		return nil, Blob{}, fmt.Errorf("blob: open: %w", err)
	}
	st, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, Blob{}, fmt.Errorf("blob: stat: %w", err)
	}
	return f, Blob{SHA: sha, Size: st.Size(), Mime: mime, Ext: allowed[mime]}, nil
}

// Exists reports whether sha is stored.
func (s *Store) Exists(sha string) bool {
	if !ValidSHA(sha) {
		return false
	}
	_, _, ok := s.find(sha)
	return ok
}

// Delete removes the file for sha; deleting a missing file is not an error.
func (s *Store) Delete(sha string) error {
	if !ValidSHA(sha) {
		return ErrBadSHA
	}
	p, _, ok := s.find(sha)
	if !ok {
		return nil
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("blob: delete: %w", err)
	}
	return nil
}

// Walk calls fn with the sha and modification time of every stored file; the janitor uses it to find orphans.
func (s *Store) Walk(fn func(sha string, modTime int64) error) error {
	top, err := os.ReadDir(filepath.Join(s.root, "images"))
	if err != nil {
		return fmt.Errorf("blob: walk: %w", err)
	}
	for _, d := range top {
		if !d.IsDir() || len(d.Name()) != 2 {
			continue
		}
		files, err := os.ReadDir(filepath.Join(s.root, "images", d.Name()))
		if err != nil {
			return fmt.Errorf("blob: walk: %w", err)
		}
		for _, f := range files {
			name := f.Name()
			if len(name) < 64 || !ValidSHA(name[:64]) {
				continue
			}
			info, err := f.Info()
			if err != nil {
				continue
			}
			if err := fn(name[:64], info.ModTime().Unix()); err != nil {
				return err
			}
		}
	}
	return nil
}
