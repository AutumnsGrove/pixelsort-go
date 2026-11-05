package testutil_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
	"pgregory.net/rapid"
)

// TestGradientKnownValues pins the synthetic image. It is the input to every golden, so it must never drift.
//
//	w=3, h=2, seed=0: r = x*255/2, g = y*255/1, b = ((x^y)*5) & 255
//	row 0: (0,0,0) (127,0,5) (255,0,10)
//	row 1: (0,255,5) (127,255,0) (255,255,15)
func TestGradientKnownValues(t *testing.T) {
	im := testutil.Gradient(3, 2, 0)
	want := [][3]uint8{
		{0, 0, 0}, {127, 0, 5}, {255, 0, 10},
		{0, 255, 5}, {127, 255, 0}, {255, 255, 15},
	}
	if im.W != 3 || im.H != 2 || len(im.Pix) != 6 {
		t.Fatalf("Gradient(3,2,0) = %dx%d with %d pixels", im.W, im.H, len(im.Pix))
	}
	for i, w := range want {
		r, g, b, a := engine.Unpack(im.Pix[i])
		if r != w[0] || g != w[1] || b != w[2] || a != 255 {
			t.Errorf("pixel %d = %d,%d,%d,%d, want %d,%d,%d,255", i, r, g, b, a, w[0], w[1], w[2])
		}
	}
}

func TestGradientIsStable(t *testing.T) {
	a, b := testutil.Gradient(17, 9, 3), testutil.Gradient(17, 9, 3)
	for i := range a.Pix {
		if a.Pix[i] != b.Pix[i] {
			t.Fatalf("two calls differ at %d", i)
		}
	}
	if testutil.Gradient(17, 9, 3).Pix[0] == testutil.Gradient(17, 9, 4).Pix[0] &&
		testutil.Gradient(17, 9, 3).Pix[5] == testutil.Gradient(17, 9, 4).Pix[5] {
		t.Error("the seed does not change the image")
	}
}

func TestUniqueIDImageKeepsIdentity(t *testing.T) {
	const w, h = 256, 256
	im := testutil.UniqueIDImage(w, h)
	seen := make(map[uint32]bool, w*h)
	for i, p := range im.Pix {
		r, g, b, a := engine.Unpack(p)
		if got := int(b)<<8 | int(g); got != i {
			t.Fatalf("pixel %d carries id %d", i, got)
		}
		if int(r) != i%7 {
			t.Fatalf("pixel %d has red %d, want %d", i, r, i%7)
		}
		if a != 255 {
			t.Fatalf("pixel %d has alpha %d", i, a)
		}
		if seen[p] && i%7 == 0 {
			// Only equal tracers collide, and only in the id bytes, which cannot repeat below 65536 pixels.
			t.Fatalf("pixel %d repeats an earlier one", i)
		}
		seen[p] = true
	}
}

func TestProp_ParamsGenValidates(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		p := testutil.ParamsGen().Draw(t, "params")
		if err := p.Validate(); err != nil {
			t.Fatalf("generated invalid params: %v", err)
		}
	})
}

func TestProp_RegionsGenValidates(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 30).Draw(t, "w")
		h := rapid.IntRange(1, 30).Draw(t, "h")
		r := testutil.RegionsGen(w, h).Draw(t, "regions")
		if err := r.Validate(w, h); err != nil {
			t.Fatalf("generated invalid regions: %v", err)
		}
	})
}

func TestGridCells(t *testing.T) {
	cells := testutil.GridCells(5, 3, 2)
	if len(cells) != 15 {
		t.Fatalf("GridCells(5,3,2) has %d cells", len(cells))
	}
	for i, c := range cells {
		if c == 0 {
			t.Fatalf("position %d is not in any cell", i)
		}
	}
	// A 5x3 image in 2x2 squares is a 3x2 grid of cells: 6 of them, numbered row by row from 1.
	want := []uint16{1, 1, 2, 2, 3, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6}
	for i := range want {
		if cells[i] != want[i] {
			t.Fatalf("cells = %v, want %v", cells, want)
		}
	}
}

func TestClassPattern(t *testing.T) {
	for _, pattern := range []string{"checker", "thirds", "all", "random"} {
		classes := testutil.ClassPattern(10, pattern, 1)
		if len(classes) != 11 {
			t.Fatalf("%s: %d classes for 10 cells", pattern, len(classes))
		}
		if classes[0] != 0 {
			t.Errorf("%s: the gaps (cell 0) are class %d, want 0", pattern, classes[0])
		}
		for id := 1; id < len(classes); id++ {
			if classes[id] < 1 || classes[id] > 4 {
				t.Errorf("%s: cell %d is class %d, want 1..4", pattern, id, classes[id])
			}
		}
	}
	// The same seed gives the same pattern, which is what makes a re-run reproducible.
	a := testutil.ClassPattern(20, "random", 5)
	b := testutil.ClassPattern(20, "random", 5)
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("ClassPattern is not deterministic at %d", i)
		}
	}
}
