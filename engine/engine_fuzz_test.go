package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// FuzzEngineVersionStable exists so the Makefile's fuzz loop has a target to find and run. Real targets
// arrive with the engine's own behaviour in phase 1.
func FuzzEngineVersionStable(f *testing.F) {
	f.Add(1)
	f.Fuzz(func(t *testing.T, _ int) {
		if engine.EngineVersion == "" {
			t.Fatal("empty")
		}
	})
}
