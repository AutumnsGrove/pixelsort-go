// Package server serves the web app and the gallery API.
package server

import (
	"fmt"
	"net/http"
)

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

// cspTemplate is the policy sent with every response; %s is where inline-script hashes go. connect-src allows https:
// because the browser fetches an image by URL directly (PLAN.md URL loading); style-src needs 'unsafe-inline' for
// Svelte's scoped styles.
const cspTemplate = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'%s; worker-src 'self' blob:; " +
	"img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' https:; " +
	"object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

// ContentSecurityPolicy builds the policy, allowing exactly the given inline scripts. SvelteKit's static build starts
// the app from one inline script whose content changes every build, so the server hashes it at startup instead of
// allowing 'unsafe-inline'.
func ContentSecurityPolicy(scriptHashes []string) string {
	extra := ""
	for _, h := range scriptHashes {
		extra += " " + h
	}
	return fmt.Sprintf(cspTemplate, extra)
}

// SecurityHeaders adds the cross-origin isolation headers plus the usual hardening headers to every response.
func SecurityHeaders(csp string, next http.Handler) http.Handler {
	return CrossOriginIsolation(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", csp)
		next.ServeHTTP(w, r)
	}))
}
