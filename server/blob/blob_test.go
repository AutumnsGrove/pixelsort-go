package blob_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/server/blob"
)

func tinyPNG(t testing.TB, shade uint8) []byte {
	t.Helper()
	im := image.NewGray(image.Rect(0, 0, 4, 4))
	im.Pix[0] = shade
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func sum(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

func newStore(t testing.TB, max int64) (*blob.Store, string) {
	t.Helper()
	root := t.TempDir()
	s, err := blob.New(root, max)
	if err != nil {
		t.Fatal(err)
	}
	return s, root
}

func files(t testing.TB, root string) []string {
	t.Helper()
	var out []string
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			out = append(out, p)
		}
		return nil
	})
	return out
}

func TestPutOpenRoundTrip(t *testing.T) {
	s, _ := newStore(t, 1<<20)
	data := tinyPNG(t, 9)
	b, err := s.Put(context.Background(), bytes.NewReader(data), sum(data))
	if err != nil {
		t.Fatal(err)
	}
	if b.SHA != sum(data) || b.Mime != "image/png" || b.Ext != ".png" || b.Size != int64(len(data)) {
		t.Fatalf("blob %+v", b)
	}
	f, got, err := s.Open(b.SHA)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close() //nolint:errcheck // test
	read, _ := io.ReadAll(f)
	if !bytes.Equal(read, data) || got.Mime != "image/png" || !s.Exists(b.SHA) {
		t.Fatal("round trip differs")
	}
}

func TestDedupeWritesNothingNew(t *testing.T) {
	s, root := newStore(t, 1<<20)
	data := tinyPNG(t, 3)
	for i := 0; i < 2; i++ {
		if _, err := s.Put(context.Background(), bytes.NewReader(data), ""); err != nil {
			t.Fatal(err)
		}
	}
	if n := len(files(t, root)); n != 1 {
		t.Fatalf("%d files", n)
	}
}

func TestHashMismatchLeavesNothing(t *testing.T) {
	s, root := newStore(t, 1<<20)
	_, err := s.Put(context.Background(), bytes.NewReader(tinyPNG(t, 1)), strings.Repeat("a", 64))
	if !errors.Is(err, blob.ErrHashMismatch) {
		t.Fatalf("got %v", err)
	}
	if n := len(files(t, root)); n != 0 {
		t.Fatalf("%d files left", n)
	}
}

func TestOversizeAborts(t *testing.T) {
	s, root := newStore(t, 100)
	data := append(tinyPNG(t, 1), make([]byte, 2000)...)
	if _, err := s.Put(context.Background(), bytes.NewReader(data), ""); !errors.Is(err, blob.ErrTooLarge) {
		t.Fatalf("got %v", err)
	}
	if n := len(files(t, root)); n != 0 {
		t.Fatalf("%d files left", n)
	}
}

func TestNonImageRejected(t *testing.T) {
	s, root := newStore(t, 1<<20)
	for _, data := range [][]byte{[]byte("hello world"), []byte("<svg xmlns='http://www.w3.org/2000/svg'/>"), {}, []byte("%PDF-1.4")} {
		if _, err := s.Put(context.Background(), bytes.NewReader(data), ""); !errors.Is(err, blob.ErrBadType) {
			t.Errorf("%q: got %v", data, err)
		}
	}
	if n := len(files(t, root)); n != 0 {
		t.Fatalf("%d files left", n)
	}
}

func TestTruncatedPNGIsClassifiedByItsHeader(t *testing.T) {
	s, _ := newStore(t, 1<<20)
	data := tinyPNG(t, 1)[:20]
	b, err := s.Put(context.Background(), bytes.NewReader(data), "")
	if err != nil || b.Mime != "image/png" {
		t.Fatalf("%+v %v", b, err)
	}
}

func TestSHAValidation(t *testing.T) {
	s, _ := newStore(t, 1<<20)
	for _, bad := range []string{"", strings.Repeat("a", 63), strings.Repeat("A", 64), "../../etc/passwd", strings.Repeat("a", 63) + "\x00", strings.Repeat("g", 64), strings.Repeat("a", 62) + "/a"} {
		if blob.ValidSHA(bad) || s.Exists(bad) {
			t.Errorf("%q accepted", bad)
		}
		if _, _, err := s.Open(bad); !errors.Is(err, blob.ErrBadSHA) {
			t.Errorf("Open(%q): %v", bad, err)
		}
		if err := s.Delete(bad); !errors.Is(err, blob.ErrBadSHA) {
			t.Errorf("Delete(%q): %v", bad, err)
		}
	}
}

func TestConcurrentPutsLeaveOneFile(t *testing.T) {
	s, root := newStore(t, 1<<20)
	data := tinyPNG(t, 5)
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Put(context.Background(), bytes.NewReader(data), ""); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if n := len(files(t, root)); n != 1 {
		t.Fatalf("%d files", n)
	}
}

func TestDeleteAndWalk(t *testing.T) {
	s, _ := newStore(t, 1<<20)
	b, _ := s.Put(context.Background(), bytes.NewReader(tinyPNG(t, 7)), "")
	var seen []string
	if err := s.Walk(func(sha string, _ int64) error { seen = append(seen, sha); return nil }); err != nil || len(seen) != 1 || seen[0] != b.SHA {
		t.Fatalf("walk %v %v", seen, err)
	}
	if err := s.Delete(b.SHA); err != nil || s.Exists(b.SHA) {
		t.Fatalf("delete %v", err)
	}
	if err := s.Delete(b.SHA); err != nil {
		t.Fatal("deleting a missing blob must not fail")
	}
}

func TestPermissions(t *testing.T) {
	s, root := newStore(t, 1<<20)
	b, _ := s.Put(context.Background(), bytes.NewReader(tinyPNG(t, 8)), "")
	info, err := os.Stat(filepath.Join(root, "images", b.SHA[:2], b.SHA+".png"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v %v", info, err)
	}
	dir, _ := os.Stat(filepath.Join(root, "images", b.SHA[:2]))
	if dir.Mode().Perm() != 0o700 {
		t.Fatalf("dir mode %v", dir.Mode().Perm())
	}
}

func FuzzBlobPut(f *testing.F) {
	f.Add(tinyPNG(f, 1))
	f.Add([]byte("GIF89a......"))
	f.Add([]byte{0xff, 0xd8, 0xff})
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, data []byte) {
		s, root := newStore(t, 1<<16)
		_, err := s.Put(context.Background(), bytes.NewReader(data), "")
		for _, p := range files(t, root) {
			if strings.Contains(p, ".tmp") {
				t.Fatalf("temp file left behind: %s (err %v)", p, err)
			}
		}
	})
}

func FuzzSHA(f *testing.F) {
	f.Add(strings.Repeat("a", 64))
	f.Add("../../x")
	f.Fuzz(func(t *testing.T, s string) {
		if !blob.ValidSHA(s) {
			return
		}
		if len(s) != 64 || strings.ContainsAny(s, "/\\\x00.") || strings.Trim(s, "0123456789abcdef") != "" {
			t.Fatalf("accepted %q", s)
		}
	})
}
