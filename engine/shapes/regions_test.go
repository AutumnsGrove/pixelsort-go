package shapes_test

import (
	"encoding/binary"
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/engine/shapes"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
	"pgregory.net/rapid"
)

func labelBytes(c shapes.Cells) []byte {
	b := make([]byte, 2*len(c.Labels))
	for i, l := range c.Labels {
		binary.LittleEndian.PutUint16(b[2*i:], l)
	}
	return b
}

// TestGoldenLabelMaps pins every shape's label map. The same files are checked on arm64, amd64 and WASM: if one platform
// disagrees, that shape's geometry must move to fixed point (the golden never changes to match).
func TestGoldenLabelMaps(t *testing.T) {
	custom := shapes.Tiling{Shape: shapes.Custom, Size: 200, Gap: 20, Rotate: 20, Poly: [][2]float64{{0.5, 0.05}, {0.95, 0.95}, {0.05, 0.95}}}
	cases := map[string]shapes.Tiling{
		"square-0":    tile(shapes.Square, 120, 10, 0),
		"diamond-0":   tile(shapes.Diamond, 120, 10, 0),
		"circle-17":   tile(shapes.Circle, 120, 10, 17),
		"octagon-45":  tile(shapes.Octagon, 120, 10, 45),
		"hexagon-0":   tile(shapes.Hexagon, 120, 10, 0),
		"hexagon-33":  tile(shapes.Hexagon, 100, 0, 33),
		"triangle-0":  tile(shapes.Triangle, 150, 10, 0),
		"triangle-61": tile(shapes.Triangle, 150, 0, 61),
		"voronoi-1":   tile(shapes.Voronoi, 120, 10, 0),
		"custom-20":   custom,
	}
	names := make([]string, 0, len(cases))
	for n := range cases {
		names = append(names, n)
	}
	slices.Sort(names)
	for _, n := range names {
		c, err := shapes.Tessellate(97, 61, cases[n])
		if err != nil {
			t.Fatalf("%s: %v", n, err)
		}
		testutil.Golden(t, "shape-"+n, labelBytes(c))
	}
}

// regionsFor builds the engine's region map for a tiling: labels, a class per cell, and one definition per class.
func regionsFor(t failer, w, h int, tl shapes.Tiling, frozenClass, turnedClass int) *engine.Regions {
	t.Helper()
	c, err := shapes.Tessellate(w, h, tl)
	if err != nil {
		t.Fatalf("tessellate: %v", err)
	}
	classOf := shapes.Classify(c, tl.Pattern, tl.Kinds, tl.Seed)
	top := 0
	for _, k := range classOf {
		top = max(top, int(k))
	}
	defs := make([]engine.ClassDef, top+1)
	defs[0].Frozen = true // the gaps between shapes are frozen by whoever builds the regions, not by the engine (E10)
	if frozenClass > 0 && frozenClass < len(defs) {
		defs[frozenClass].Frozen = true
	}
	if turnedClass > 0 && turnedClass < len(defs) {
		angle := 90
		defs[turnedClass].Angle = &angle
	}
	return &engine.Regions{Labels: c.Labels, ClassOf: classOf, Defs: defs}
}

// TestProp_RegionsThroughThePlanner: for any tiling and pattern, the sort never crosses a cell boundary, frozen classes
// never move, and the result is a permutation (properties 2, 3 and 7 of docs/dev/testing.md, with real tessellations).
func TestProp_RegionsThroughThePlanner(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(8, 70).Draw(t, "w")
		h := rapid.IntRange(8, 70).Draw(t, "h")
		tl := shapes.Tiling{
			Shape: rapid.SampledFrom(allShapes).Draw(t, "shape"), Size: rapid.IntRange(60, 400).Draw(t, "size"),
			Gap: rapid.IntRange(0, 40).Draw(t, "gap"), Rotate: rapid.IntRange(0, 359).Draw(t, "rotate"), Seed: rapid.Uint32().Draw(t, "seed"),
			Pattern: rapid.SampledFrom([]string{"all", "checker", "thirds", "random"}).Draw(t, "pattern"),
		}
		reg := regionsFor(t, w, h, tl, 2, 3)
		im := testutil.Gradient(w, h, 5)
		p := engine.DefaultParams()
		p.Mode, p.Randomness = engine.ModeNone, 0
		pl, err := engine.NewPlan(im, p, &engine.Options{Regions: reg})
		if err != nil {
			t.Fatal(err)
		}
		for _, iv := range pl.Intervals {
			cell := reg.Labels[pl.Lines.P[iv.A]]
			for i := iv.A; i < iv.B; i++ {
				pos := pl.Lines.P[i]
				if reg.Labels[pos] != cell {
					t.Fatalf("an interval crosses from cell %d to %d", cell, reg.Labels[pos])
				}
				if reg.Defs[reg.ClassOf[cell]].Frozen {
					t.Fatalf("a frozen class has an interval")
				}
			}
		}
		out := pl.Sort()
		for pos := range im.Pix {
			if reg.Labels[pos] == 0 || reg.Defs[reg.ClassOf[reg.Labels[pos]]].Frozen {
				if out.Pix[pos] != im.Pix[pos] {
					t.Fatalf("pixel %d is in a gap or a frozen class but moved", pos)
				}
			}
		}
		a, b := slices.Clone(out.Pix), slices.Clone(im.Pix)
		slices.Sort(a)
		slices.Sort(b)
		if !slices.Equal(a, b) {
			t.Fatal("the result is not a permutation of the input")
		}
	})
}

// TestHexagonsWithMixedClasses is the exit criterion: cut a picture into hexagons, freeze one kind, turn one, and sort.
func TestHexagonsWithMixedClasses(t *testing.T) {
	tl := tile(shapes.Hexagon, 150, 8, 0)
	tl.Pattern = shapes.PatternThirds
	reg := regionsFor(t, 120, 90, tl, 1, 2)
	hv := engine.AlgoMerge
	reg.Defs[3].Algo = &hv
	im := testutil.Gradient(120, 90, 2)
	p := engine.DefaultParams()
	p.Randomness = 0
	pl, err := engine.NewPlan(im, p, &engine.Options{Regions: reg})
	if err != nil {
		t.Fatal(err)
	}
	if pl.Stats.Intervals == 0 || pl.Stats.FrozenPixels == 0 {
		t.Fatalf("stats %+v: expected intervals and frozen pixels", pl.Stats)
	}
	s := pl.NewStepper()
	for !s.Done() && s.Pass() < 2000 {
		s.Step()
	}
	if !slices.Equal(s.Result().Pix, pl.Sort().Pix) {
		t.Fatal("stepped mixed-class hexagons differ from the instant sort")
	}
}
