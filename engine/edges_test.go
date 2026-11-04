package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"pgregory.net/rapid"
)

func TestEdgeMapFlatIsZero(t *testing.T) {
	luma := make([]uint8, 5*4)
	for i := range luma {
		luma[i] = 100
	}
	for i, v := range engine.EdgeMap(luma, 5, 4) {
		if v != 0 {
			t.Fatalf("flat image has an edge at %d: %d", i, v)
		}
	}
}

// TestEdgeMapSinglePixel writes out the whole 3x3 result for one bright pixel on black:
//
//	centre     : |8*200 - 0|        = 1600, clamped to 255
//	neighbours : |8*0   - 200|      = 200  (every one of them touches the centre)
func TestEdgeMapSinglePixel(t *testing.T) {
	luma := []uint8{0, 0, 0, 0, 200, 0, 0, 0, 0}
	want := []uint8{200, 200, 200, 200, 255, 200, 200, 200, 200}
	got := engine.EdgeMap(luma, 3, 3)
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("EdgeMap = %v, want %v", got, want)
		}
	}
}

func TestEdgeMapOnePixelIsZero(t *testing.T) {
	// With replication every neighbour is the pixel itself, so 8c - 8c = 0.
	if got := engine.EdgeMap([]uint8{77}, 1, 1); len(got) != 1 || got[0] != 0 {
		t.Fatalf("EdgeMap(1x1) = %v, want [0]", got)
	}
}

// TestEdgeMapStepEdge works a 1xN case by hand. In a one-pixel-wide column the left and right neighbours replicate
// the pixel, so with three rows contributing:
//
//	value(y) = |8*l(y) - 3*l(y-1) - 2*l(y) - 3*l(y+1)| = 3*|2*l(y) - l(y-1) - l(y+1)|
//
// For l = [0 0 255 255]: y0 = 3*|0-0-0| = 0; y1 = 3*|0-0-255| = 765 -> 255; y2 = 3*|510-0-255| = 765 -> 255;
// y3 = 3*|510-255-255| = 0.
func TestEdgeMapStepEdge(t *testing.T) {
	luma := []uint8{0, 0, 255, 255}
	want := []uint8{0, 255, 255, 0}
	got := engine.EdgeMap(luma, 1, 4)
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("EdgeMap = %v, want %v", got, want)
		}
	}
}

func TestProp_EdgeMapRange(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 24).Draw(t, "w")
		h := rapid.IntRange(1, 24).Draw(t, "h")
		luma := rapid.SliceOfN(rapid.Byte(), w*h, w*h).Draw(t, "luma")
		got := engine.EdgeMap(luma, w, h)
		if len(got) != w*h {
			t.Fatalf("%dx%d: %d values", w, h, len(got))
		}
	})
}
