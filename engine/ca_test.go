package engine_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
	"pgregory.net/rapid"
)

func TestCAGridDeterministic(t *testing.T) {
	a := engine.CAGrid(32, 20, 110, engine.CABoundaryRandom, 7)
	b := engine.CAGrid(32, 20, 110, engine.CABoundaryRandom, 7)
	c := engine.CAGrid(32, 20, 110, engine.CABoundaryRandom, 8)
	if !slices.EqualFunc(a, b, slices.Equal[[]uint8]) {
		t.Fatal("same rule and seed gave different grids")
	}
	if slices.EqualFunc(a, c, slices.Equal[[]uint8]) {
		t.Fatal("different seeds gave the same grid")
	}
}

func TestCAGridEmptyIsNil(t *testing.T) {
	if engine.CAGrid(0, 5, 30, engine.CABoundaryFixed, 1) != nil || engine.CAGrid(5, 0, 30, engine.CABoundaryFixed, 1) != nil {
		t.Fatal("an empty grid should be nil")
	}
}

func TestProp_CAMapShape(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 40).Draw(t, "w")
		h := rapid.IntRange(1, 40).Draw(t, "h")
		cell := rapid.IntRange(1, 12).Draw(t, "cell")
		rule := uint8(rapid.IntRange(0, 255).Draw(t, "rule"))
		b := rapid.SampledFrom([]string{engine.CABoundaryRandom, engine.CABoundaryWrap, engine.CABoundaryFixed}).Draw(t, "boundary")
		grid := engine.CAGrid((w+cell-1)/cell, (h+cell-1)/cell, rule, b, rapid.Uint32().Draw(t, "seed"))
		m := engine.CAMapImage(w, h, cell, grid)
		if len(m) != w*h {
			t.Fatalf("len %d, want %d", len(m), w*h)
		}
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				v := m[y*w+x]
				if v > 1 {
					t.Fatalf("value %d", v)
				}
				if v != grid[y/cell][x/cell] {
					t.Fatalf("pixel (%d,%d) is not its cell's value", x, y)
				}
			}
		}
	})
}

func FuzzCARule(f *testing.F) {
	f.Add(uint8(30), uint8(20), uint8(10), uint8(3), uint32(1))
	f.Add(uint8(255), uint8(1), uint8(1), uint8(1), uint32(0))
	f.Fuzz(func(t *testing.T, rule, w, h, cell uint8, seed uint32) {
		ww, hh, cc := int(w)%60+1, int(h)%60+1, int(cell)%16+1
		for _, b := range []string{engine.CABoundaryRandom, engine.CABoundaryWrap, engine.CABoundaryFixed} {
			g := engine.CAGrid((ww+cc-1)/cc, (hh+cc-1)/cc, rule, b, seed)
			m := engine.CAMapImage(ww, hh, cc, g)
			if !slices.Equal(m, engine.CAMapImage(ww, hh, cc, engine.CAGrid((ww+cc-1)/cc, (hh+cc-1)/cc, rule, b, seed))) {
				t.Fatal("not deterministic")
			}
			for _, v := range m {
				if v > 1 {
					t.Fatalf("value %d", v)
				}
			}
		}
	})
}

// ---- plans ----

func caRecipe(mode engine.IntervalMode) engine.Params {
	p := engine.DefaultParams()
	p.Mode, p.Randomness, p.Key = mode, 0, engine.KeyRed
	return p
}

func TestPlanCACutsOnRisingEdge(t *testing.T) {
	// One 10-pixel line, mask 0011000110: it turns on at positions 2 and 7, so the cuts are before 2 and before 7.
	mask := []uint8{0, 0, 1, 1, 0, 0, 0, 1, 1, 0}
	pl := mustPlan(t, testutil.Gradient(10, 1, 1), caRecipe(engine.ModeCA), &engine.Options{CAMask: mask})
	want := []engine.Interval{{A: 0, B: 2}, {A: 2, B: 7}, {A: 7, B: 10}}
	if !slices.Equal(pl.Intervals, want) {
		t.Fatalf("intervals %v, want %v", pl.Intervals, want)
	}
}

func TestPlanCAEdgesThresholdZeroCutsAtEveryTransition(t *testing.T) {
	// A mask edge shows up as a run of edge pixels on both sides of a transition, so with threshold 0 the plan cuts at
	// the first pixel of each such run: before the pixel just left of a rise or fall.
	mask := []uint8{0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0}
	p := caRecipe(engine.ModeCAEdges)
	p.Edge = 0
	pl := mustPlan(t, testutil.Gradient(12, 1, 1), p, &engine.Options{CAMask: mask})
	if len(pl.Intervals) < 3 {
		t.Fatalf("intervals %v: expected cuts at the transitions", pl.Intervals)
	}
	for _, iv := range pl.Intervals {
		if iv.B-iv.A < 2 {
			t.Fatalf("short interval %v", iv)
		}
	}
}

func TestPlanCARejectsWrongMaskLength(t *testing.T) {
	_, err := engine.NewPlan(testutil.Gradient(4, 4, 1), caRecipe(engine.ModeCA), &engine.Options{CAMask: make([]uint8, 3)})
	if err == nil {
		t.Fatal("a mask of the wrong length was accepted")
	}
}

func TestPlanCADeterministic(t *testing.T) {
	for _, mode := range []engine.IntervalMode{engine.ModeCA, engine.ModeCAEdges} {
		p := caRecipe(mode)
		p.Angle = 33
		a := mustPlan(t, testutil.Gradient(60, 40, 2), p, nil)
		b := mustPlan(t, testutil.Gradient(60, 40, 2), p, nil)
		if !slices.Equal(a.Intervals, b.Intervals) {
			t.Fatalf("%s: two plans of the same recipe differ", mode)
		}
		if len(a.Intervals) == 0 {
			t.Fatalf("%s: no intervals at all", mode)
		}
	}
}

// ---- line space ----

func intervalsOf(t *testing.T, w, h, angle int, space string, mode engine.IntervalMode) []engine.Interval {
	t.Helper()
	p := caRecipe(mode)
	p.Angle, p.CASpace, p.Cell, p.Rule = angle, space, 40, 90
	return mustPlan(t, testutil.Gradient(w, h, 2), p, nil).Intervals
}

func TestCALineEqualsImageAtAngleZero(t *testing.T) {
	for _, mode := range []engine.IntervalMode{engine.ModeCA, engine.ModeCAEdges} {
		img := intervalsOf(t, 97, 61, 0, engine.CASpaceImage, mode)
		line := intervalsOf(t, 97, 61, 0, engine.CASpaceLine, mode)
		if !slices.Equal(img, line) {
			t.Fatalf("%s: line space and image space differ at angle 0", mode)
		}
	}
}

func TestCALineRotatesWithAngle(t *testing.T) {
	// On a square image, angle 90 walks the columns bottom to top, so line space read along them is the same pattern
	// that image space shows along rows at angle 0: the interval lengths per line match.
	lengths := func(ivs []engine.Interval) []int32 {
		out := make([]int32, len(ivs))
		for i, iv := range ivs {
			out[i] = iv.B - iv.A
		}
		return out
	}
	a := lengths(intervalsOf(t, 64, 64, 0, engine.CASpaceLine, engine.ModeCA))
	b := lengths(intervalsOf(t, 64, 64, 90, engine.CASpaceLine, engine.ModeCA))
	if !slices.Equal(a, b) {
		t.Fatal("the line-space pattern did not turn with the sort")
	}
}

func TestCALineDiffersFromImageAtOtherAngles(t *testing.T) {
	if slices.Equal(intervalsOf(t, 97, 61, 37, engine.CASpaceImage, engine.ModeCA), intervalsOf(t, 97, 61, 37, engine.CASpaceLine, engine.ModeCA)) {
		t.Fatal("at 37 degrees the two spaces should differ")
	}
}
