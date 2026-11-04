package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// FuzzKeys checks that no pixel value and no key can panic, and that reversing a key really is 255-key.
func FuzzKeys(f *testing.F) {
	f.Add(uint32(0), 0)
	f.Add(engine.Pack(255, 0, 0, 255), 1)
	f.Add(engine.Pack(0, 0, 0, 0), 4)
	f.Add(engine.Pack(128, 128, 128, 255), 5)
	f.Add(^uint32(0), 9)
	f.Fuzz(func(t *testing.T, pixel uint32, keyIdx int) {
		keys := allKeys()
		k := keys[((keyIdx%len(keys))+len(keys))%len(keys)]
		fwd, rev := engine.KeyFor(k, false)(pixel), engine.KeyFor(k, true)(pixel)
		if rev != 255-fwd {
			t.Fatalf("%s of %#x: reversed %d, forward %d", k, pixel, rev, fwd)
		}
	})
}
