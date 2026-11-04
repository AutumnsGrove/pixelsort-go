package server

import (
	"mime"
	"net/http"
)

// NewStaticHandler serves dir with the right type for .wasm (browsers refuse streaming compile otherwise) and
// with cross-origin isolation.
func NewStaticHandler(dir string) http.Handler {
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	return CrossOriginIsolation(http.FileServer(http.Dir(dir)))
}
