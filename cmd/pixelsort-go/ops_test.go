package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server/blob"
	"github.com/AutumnsGrove/pixelsort-go/server/db"
	"github.com/AutumnsGrove/pixelsort-go/server/runs"
)

func tinyPNG(n int) ([]byte, string) {
	g := image.NewGray(image.Rect(0, 0, 4, 4))
	g.Pix[0], g.Pix[1] = uint8(n), uint8(n>>8)
	var b bytes.Buffer
	if err := png.Encode(&b, g); err != nil {
		panic(err) // encoding a 4x4 gray image cannot fail
	}
	s := sha256.Sum256(b.Bytes())
	return b.Bytes(), hex.EncodeToString(s[:])
}

// gallery builds a data directory with real runs through the phase 6 service.
func gallery(t *testing.T, n int) (dir string, svc *runs.Service, ids []int64) {
	t.Helper()
	dir = t.TempDir()
	d, err := db.Open(filepath.Join(dir, "pixelsort.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := db.Migrate(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	store, err := blob.New(dir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	svc = runs.New(d, store, 7)
	for i := 0; i < n; i++ {
		ob, os := tinyPNG(1000 + i)
		rb, rs := tinyPNG(2000 + i)
		tb, ts := tinyPNG(3000 + i)
		run, _, err := svc.Create(context.Background(), runs.Meta{
			Settings: []byte(`{"mode":"random"}`), Seed: int64(i), EngineVersion: "1",
			Original: runs.ImageMeta{SHA256: os}, Result: runs.ImageMeta{SHA256: rs}, Thumb: runs.ImageMeta{SHA256: ts},
		}, runs.Parts{Original: bytes.NewReader(ob), Result: bytes.NewReader(rb), Thumb: bytes.NewReader(tb)})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, run.ID)
	}
	return dir, svc, ids
}

func rowCount(t *testing.T, path string) int {
	t.Helper()
	d, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close() //nolint:errcheck // test
	var n int
	if err := d.QueryRow("SELECT COUNT(*) FROM runs").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSnapshotHasTheSameRows(t *testing.T) {
	dir, _, _ := gallery(t, 4)
	out := filepath.Join(t.TempDir(), "snap.db")
	n, err := snapshot(context.Background(), dir, out)
	if err != nil || n == 0 {
		t.Fatalf("%d bytes, %v", n, err)
	}
	if rowCount(t, out) != 4 {
		t.Fatal("the snapshot lost runs")
	}
	// a second snapshot over the first replaces it
	if _, err := snapshot(context.Background(), dir, out); err != nil {
		t.Fatalf("replacing a snapshot: %v", err)
	}
}

func TestSnapshotRefusesANonRegularFile(t *testing.T) {
	dir, _, _ := gallery(t, 1)
	if _, err := snapshot(context.Background(), dir, t.TempDir()); err == nil {
		t.Fatal("a directory was accepted as the output")
	}
}

func TestSnapshotWhileAWriterIsActive(t *testing.T) {
	dir, svc, _ := gallery(t, 2)
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			ob, os := tinyPNG(5000 + i)
			rb, rs := tinyPNG(6000 + i)
			tb, ts := tinyPNG(7000 + i)
			_, _, _ = svc.Create(context.Background(), runs.Meta{Settings: []byte(`{}`), Seed: int64(i), EngineVersion: "1",
				Original: runs.ImageMeta{SHA256: os}, Result: runs.ImageMeta{SHA256: rs}, Thumb: runs.ImageMeta{SHA256: ts}},
				runs.Parts{Original: bytes.NewReader(ob), Result: bytes.NewReader(rb), Thumb: bytes.NewReader(tb)})
		}
	}()
	for i := 0; i < 3; i++ {
		out := filepath.Join(t.TempDir(), "snap.db")
		if _, err := snapshot(context.Background(), dir, out); err != nil {
			t.Fatalf("snapshot %d: %v", i, err)
		}
	}
	close(stop)
	wg.Wait()
}

func TestHealthcheck(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok","version":"x"}`))
	}))
	defer ok.Close()
	if err := healthcheck(context.Background(), strings.TrimPrefix(ok.URL, "http://")); err != nil {
		t.Fatalf("healthy server: %v", err)
	}
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) }))
	defer bad.Close()
	if err := healthcheck(context.Background(), strings.TrimPrefix(bad.URL, "http://")); err == nil {
		t.Fatal("a 500 passed")
	}
	wrong := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"status":"sick"}`)) }))
	defer wrong.Close()
	if err := healthcheck(context.Background(), strings.TrimPrefix(wrong.URL, "http://")); err == nil {
		t.Fatal("a body that is not ok passed")
	}
	closed := httptest.NewServer(http.NotFoundHandler())
	addr := strings.TrimPrefix(closed.URL, "http://")
	closed.Close()
	start := time.Now()
	if err := healthcheck(context.Background(), addr); err == nil || time.Since(start) > 4*time.Second {
		t.Fatalf("a closed port should fail fast: %v after %v", err, time.Since(start))
	}
}

func TestStarredListPrintsOnlyStarredResults(t *testing.T) {
	dir, svc, ids := gallery(t, 4)
	yes := true
	for _, i := range []int{0, 1, 2} {
		if _, err := svc.Update(context.Background(), ids[i], runs.Patch{Starred: &yes}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.Trash(context.Background(), []int64{ids[2]}, true); err != nil { // starred but in the bin
		t.Fatal(err)
	}
	got, err := starredList(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("%v: want the results of runs 0 and 1 only", got)
	}
	for i, p := range got {
		want, _ := svc.Get(context.Background(), ids[i])
		if !strings.HasPrefix(p, "images/"+want.Result.SHA256[:2]+"/"+want.Result.SHA256) {
			t.Errorf("%s is not run %d's result", p, ids[i])
		}
	}
}
