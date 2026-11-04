//go:build js && wasm

// Command wasm is the browser entry point: it exposes the engine to JavaScript as globalThis.pixelsort.
package main

import (
	"syscall/js"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

func main() {
	api := js.Global().Get("Object").New()
	api.Set("ping", js.FuncOf(func(this js.Value, args []js.Value) any { return engine.EngineVersion }))
	js.Global().Set("pixelsort", api)
	js.Global().Set("pixelsortReady", true)
	select {} // keep the Go runtime alive so JavaScript can call back in
}
