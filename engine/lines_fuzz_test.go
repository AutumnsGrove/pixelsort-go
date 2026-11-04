package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// FuzzPartition looks for a size and angle where the partition loses, duplicates or invents a pixel.
func FuzzPartition(f *testing.F) {
	f.Add(1, 1, 0)
	f.Add(1, 40, 90)
	f.Add(40, 1, 45)
	f.Add(2, 2, 359)
	f.Add(48, 48, 135)
	f.Add(7, 3, -90)
	f.Fuzz(func(t *testing.T, w, h, angle int) {
		w = clampInt(w, 1, 48)
		h = clampInt(h, 1, 48)
		angle = ((angle % 360) + 360) % 360
		L := engine.Partition(w, h, angle)
		if len(L.P) != w*h {
			t.Fatalf("%dx%d a=%d: %d pixels, want %d", w, h, angle, len(L.P), w*h)
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
