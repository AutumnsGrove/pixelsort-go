package engine_test

import (
	"bytes"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// FuzzFromRGBA looks for panics and for round trips that do not hold. Sizes are clamped towards zero rather
// than skipped, so every draw of the fuzzer still exercises the code.
func FuzzFromRGBA(f *testing.F) {
	f.Add(2, 2, []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16})
	f.Add(1, 1, []byte{0, 0, 0, 0})
	f.Add(0, 3, []byte{})
	f.Add(3, 0, []byte{1, 2, 3, 4})
	f.Add(-5, -5, []byte{1, 2, 3, 4})
	f.Add(64, 64, []byte{})
	f.Fuzz(func(t *testing.T, w, h int, data []byte) {
		w = clampInt(w, 0, 64)
		h = clampInt(h, 0, 64)
		im, err := engine.FromRGBA(w, h, data)
		if err != nil {
			return
		}
		if !bytes.Equal(im.RGBA(), data) {
			t.Fatalf("FromRGBA(%d, %d, %d bytes) did not round trip", w, h, len(data))
		}
	})
}

// clampInt folds v into [lo, hi] without discarding the draw, so tiny and huge values still produce a test.
func clampInt(v, lo, hi int) int {
	if hi < lo {
		return lo
	}
	span := hi - lo + 1
	m := v % span
	if m < 0 {
		m += span
	}
	return lo + m
}
