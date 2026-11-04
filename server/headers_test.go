package server_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/server"
)

func TestCrossOriginIsolationSetsHeaders(t *testing.T) {
	h := server.CrossOriginIsolation(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	for k, want := range map[string]string{"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin"} {
		if got := rec.Header().Get(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("wrapped handler status lost: %d", rec.Code)
	}
}
