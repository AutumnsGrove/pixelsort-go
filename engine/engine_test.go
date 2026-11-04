package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

func TestEngineVersionIsSet(t *testing.T) {
	if engine.EngineVersion == "" {
		t.Fatal("EngineVersion must not be empty")
	}
}
