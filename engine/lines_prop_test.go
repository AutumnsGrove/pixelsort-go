package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"pgregory.net/rapid"
)

// TestProp_PartitionIsBijection is property 6: at every angle, every pixel appears in exactly one line.
func TestProp_PartitionIsBijection(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 90).Draw(t, "w")
		h := rapid.IntRange(1, 90).Draw(t, "h")
		angle := rapid.IntRange(0, 359).Draw(t, "angle")
		L := engine.Partition(w, h, angle)
		if len(L.P) != w*h {
			t.Fatalf("%dx%d a=%d: %d pixels, want %d", w, h, angle, len(L.P), w*h)
		}
		if int(L.Starts[len(L.Starts)-1]) != w*h {
			t.Fatalf("%dx%d a=%d: last start %d, want %d", w, h, angle, L.Starts[len(L.Starts)-1], w*h)
		}
		for l := 1; l < len(L.Starts); l++ {
			if L.Starts[l] <= L.Starts[l-1] {
				t.Fatalf("%dx%d a=%d: starts not strictly increasing at %d", w, h, angle, l)
			}
		}
		seen := make([]bool, w*h)
		for _, p := range L.P {
			if p < 0 || int(p) >= w*h {
				t.Fatalf("%dx%d a=%d: position %d outside the image", w, h, angle, p)
			}
			if seen[p] {
				t.Fatalf("%dx%d a=%d: position %d appears twice", w, h, angle, p)
			}
			seen[p] = true
		}
	})
}

// TestProp_LinesAreConnected checks that a line is a staircase and not scattered pixels.
//
// The exact bound: consecutive pixels of a line differ by at most 1 in x and at most 1 in y. That covers every
// angle, because the major axis steps by exactly 1 and the minor axis is round(a*m) with |m| <= 1, whose
// difference between neighbouring steps is 0 or 1 in magnitude.
func TestProp_LinesAreConnected(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(2, 60).Draw(t, "w")
		h := rapid.IntRange(2, 60).Draw(t, "h")
		angle := rapid.IntRange(0, 359).Draw(t, "angle")
		L := engine.Partition(w, h, angle)
		for l := 0; l < len(L.Starts)-1; l++ {
			line := L.P[L.Starts[l]:L.Starts[l+1]]
			for i := 1; i < len(line); i++ {
				px, py := int(line[i-1])%w, int(line[i-1])/w
				qx, qy := int(line[i])%w, int(line[i])/w
				if abs(px-qx) > 1 || abs(py-qy) > 1 {
					t.Fatalf("%dx%d a=%d: line %d jumps from (%d,%d) to (%d,%d)", w, h, angle, l, px, py, qx, qy)
				}
			}
		}
	})
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
