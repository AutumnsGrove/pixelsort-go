package masks_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/masks"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
	"pgregory.net/rapid"
)

func count(m []uint8) int {
	n := 0
	for _, v := range m {
		if v != 0 {
			n++
		}
	}
	return n
}

func at(m []uint8, w, x, y int) uint8 { return m[y*w+x] }

func rect(cx, cy, w, h float64, mode string) masks.Object {
	return masks.Object{Kind: "rect", CX: cx, CY: cy, W: w, H: h, Mode: mode}
}

func TestRectCoveringTheLeftHalf(t *testing.T) {
	// 10x4: a rect centred at 0.25 and 0.5 with width 0.5 and full height covers columns 0..4
	m := masks.Rasterize(10, 4, masks.Spec{Objects: []masks.Object{rect(0.25, 0.5, 0.5, 1, "add")}})
	if count(m) != 5*4 {
		t.Fatalf("%d frozen, want 20", count(m))
	}
	for y := 0; y < 4; y++ {
		for x := 0; x < 10; x++ {
			if (at(m, 10, x, y) == 1) != (x < 5) {
				t.Fatalf("pixel (%d,%d) = %d", x, y, at(m, 10, x, y))
			}
		}
	}
}

func TestCutPunchesAHole(t *testing.T) {
	m := masks.Rasterize(40, 40, masks.Spec{Objects: []masks.Object{rect(0.5, 0.5, 1, 1, "add"), rect(0.5, 0.5, 0.25, 0.25, "cut")}})
	if at(m, 40, 20, 20) != 0 || at(m, 40, 2, 2) != 1 {
		t.Fatal("the middle should be a hole and the corner frozen")
	}
}

func TestOrderMatters(t *testing.T) {
	cutFirst := masks.Rasterize(40, 40, masks.Spec{Objects: []masks.Object{rect(0.5, 0.5, 0.25, 0.25, "cut"), rect(0.5, 0.5, 1, 1, "add")}})
	if at(cutFirst, 40, 20, 20) != 1 || count(cutFirst) != 40*40 {
		t.Fatal("a cut before an add leaves the area frozen")
	}
}

func TestInvert(t *testing.T) {
	full := masks.Rasterize(8, 8, masks.Spec{Objects: []masks.Object{rect(0.5, 0.5, 1, 1, "add")}, Invert: true})
	if count(full) != 0 {
		t.Fatal("inverting an all-frozen mask gives all zero")
	}
	spec := masks.Spec{Objects: []masks.Object{{Kind: "ellipse", CX: 0.4, CY: 0.5, W: 0.5, H: 0.6, Mode: "add"}}}
	once := masks.Rasterize(30, 20, spec)
	spec.Invert = true
	inv := masks.Rasterize(30, 20, spec)
	for i := range once {
		if once[i]+inv[i] != 1 {
			t.Fatalf("pixel %d: mask %d, inverted %d", i, once[i], inv[i])
		}
	}
}

func TestRotatingARectBy90SwapsItsExtent(t *testing.T) {
	tall := masks.Object{Kind: "rect", CX: 0.5, CY: 0.5, W: 0.2, H: 0.6, Mode: "add"}
	turned := tall
	turned.Rot = 90
	a := masks.Rasterize(50, 50, masks.Spec{Objects: []masks.Object{tall}})
	b := masks.Rasterize(50, 50, masks.Spec{Objects: []masks.Object{turned}})
	extent := func(m []uint8) (ew, eh int) {
		minx, maxx, miny, maxy := 50, -1, 50, -1
		for i, v := range m {
			if v != 0 {
				x, y := i%50, i/50
				minx, maxx, miny, maxy = min(minx, x), max(maxx, x), min(miny, y), max(maxy, y)
			}
		}
		return maxx - minx + 1, maxy - miny + 1
	}
	aw, ah := extent(a)
	bw, bh := extent(b)
	if aw != bh || ah != bw {
		t.Fatalf("extent %dx%d then %dx%d after a quarter turn", aw, ah, bw, bh)
	}
}

func TestStrokesAndErase(t *testing.T) {
	line := masks.Stroke{Radius: 0.05, Points: [][2]float64{{0.1, 0.5}, {0.9, 0.5}}}
	m := masks.Rasterize(60, 30, masks.Spec{Strokes: []masks.Stroke{line}})
	if at(m, 60, 30, 15) != 1 || at(m, 60, 30, 2) != 0 || at(m, 60, 2, 15) != 0 {
		t.Fatal("the brush paints along the line and nowhere else")
	}
	erase := masks.Stroke{Radius: 0.03, Erase: true, Points: [][2]float64{{0.5, 0.5}}}
	m2 := masks.Rasterize(60, 30, masks.Spec{Strokes: []masks.Stroke{line, erase}})
	if at(m2, 60, 30, 15) != 0 || at(m2, 60, 12, 15) != 1 {
		t.Fatal("erase clears only where it is dragged")
	}
	if count(m2) >= count(m) {
		t.Fatal("erasing should remove pixels")
	}
}

func TestPolygonObjectAndBadInput(t *testing.T) {
	tri := masks.Object{Kind: "polygon", CX: 0.5, CY: 0.5, W: 0.8, H: 0.8, Mode: "add", Poly: [][2]float64{{0.5, 0}, {1, 1}, {0, 1}}}
	m := masks.Rasterize(40, 40, masks.Spec{Objects: []masks.Object{tri}})
	if at(m, 40, 20, 30) != 1 || at(m, 40, 2, 2) != 0 || count(m) == 0 {
		t.Fatal("a triangle freezes its inside only")
	}
	bad := masks.Spec{Objects: []masks.Object{{Kind: "polygon", CX: 0.5, CY: 0.5, W: 0.5, H: 0.5, Poly: [][2]float64{{0, 0}}}, {Kind: "star"}, {Kind: "rect", W: 0, H: 0}}}
	if count(masks.Rasterize(20, 20, bad)) != 0 {
		t.Fatal("unusable objects are ignored, never an error or a panic")
	}
}

func TestProp_RasterizeRange(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w, h := rapid.IntRange(1, 60).Draw(t, "w"), rapid.IntRange(1, 60).Draw(t, "h")
		f := rapid.Float64Range(-0.5, 1.5)
		var s masks.Spec
		for i := 0; i < rapid.IntRange(0, 4).Draw(t, "objects"); i++ {
			s.Objects = append(s.Objects, masks.Object{Kind: rapid.SampledFrom([]string{"ellipse", "rect", "polygon"}).Draw(t, "kind"),
				CX: f.Draw(t, "cx"), CY: f.Draw(t, "cy"), W: f.Draw(t, "w"), H: f.Draw(t, "h"), Rot: rapid.Float64Range(-720, 720).Draw(t, "rot"),
				Mode: rapid.SampledFrom([]string{"add", "cut"}).Draw(t, "mode"), Poly: [][2]float64{{0, 0}, {1, 0}, {0.5, 1}}})
		}
		for i := 0; i < rapid.IntRange(0, 3).Draw(t, "strokes"); i++ {
			s.Strokes = append(s.Strokes, masks.Stroke{Radius: f.Draw(t, "r"), Erase: rapid.Bool().Draw(t, "erase"), Points: [][2]float64{{f.Draw(t, "x"), f.Draw(t, "y")}}})
		}
		s.Invert = rapid.Bool().Draw(t, "invert")
		m := masks.Rasterize(w, h, s)
		if len(m) != w*h || slices.ContainsFunc(m, func(v uint8) bool { return v > 1 }) {
			t.Fatal("the plane must be w*h long and hold only 0 or 1")
		}
		if !slices.Equal(m, masks.Rasterize(w, h, s)) {
			t.Fatal("not deterministic")
		}
	})
}

func TestSoftUsesFeather(t *testing.T) {
	m := masks.Rasterize(40, 40, masks.Spec{Objects: []masks.Object{rect(0.5, 0.5, 0.4, 0.4, "add")}})
	soft := masks.Soft(40, 40, m, 0.05) // radius round(0.05*40) = 2
	if len(soft) != 40*40 {
		t.Fatalf("length %d", len(soft))
	}
	if soft[20*40+20] == 0 {
		t.Fatal("the middle of the mask should be opaque")
	}
	if soft[0] != 0 {
		t.Fatal("far from the mask there should be no blend")
	}
}

func TestGoldenCompositeMask(t *testing.T) {
	spec := masks.Spec{
		Objects: []masks.Object{
			{Kind: "ellipse", CX: 0.4, CY: 0.45, W: 0.5, H: 0.6, Rot: 25, Mode: "add"},
			{Kind: "rect", CX: 0.6, CY: 0.5, W: 0.2, H: 0.3, Rot: 40, Mode: "cut"},
			{Kind: "polygon", CX: 0.8, CY: 0.7, W: 0.3, H: 0.4, Mode: "add", Poly: [][2]float64{{0.5, 0}, {1, 1}, {0, 1}}},
		},
		Strokes: []masks.Stroke{{Radius: 0.04, Points: [][2]float64{{0.1, 0.8}, {0.5, 0.9}, {0.9, 0.2}}}},
	}
	testutil.Golden(t, "mask-composite", masks.Rasterize(97, 61, spec))
}
