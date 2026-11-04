package server_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/server"
)

func TestStaticHandlerServesWasmWithRightType(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "engine.wasm"), []byte("\x00asm\x01\x00\x00\x00"), 0o600); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	server.NewStaticHandler(dir).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/engine.wasm", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/wasm" {
		t.Errorf("Content-Type = %q, want application/wasm", got)
	}
	if rec.Header().Get("Cross-Origin-Opener-Policy") != "same-origin" {
		t.Error("static files must be cross-origin isolated")
	}
}
