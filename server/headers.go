// Package server serves the web app and the gallery API.
package server

import "net/http"

// CrossOriginIsolation sets the headers that make a page cross-origin isolated, which a future worker pool needs
// for SharedArrayBuffer. PLAN.md section 5.
func CrossOriginIsolation(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Embedder-Policy", "require-corp")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}
