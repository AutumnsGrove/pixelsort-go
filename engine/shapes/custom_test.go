package shapes_test

import (
	"errors"
	"math"
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/shapes"
	"pgregory.net/rapid"
)

var unitSquare = [][2]float64{{0, 0}, {1, 0}, {1, 1}, {0, 1}}

func custom(poly [][2]float64, more [][][2]float64) shapes.Tiling {
	t := tile(shapes.Custom, 250, 0, 0) // S = 20 on an 80 px image
	t.Poly, t.More = poly, more
	return t
}

func TestCustomFullSquareEqualsSquareTiling(t *testing.T) {
	c, err := shapes.Tessellate(80, 80, custom(unitSquare, nil))
	if err != nil {
		t.Fatal(err)
	}
	sq, _ := shapes.Tessellate(80, 80, tile(shapes.Square, 250, 0, 0))
	if !slices.Equal(c.Labels, sq.Labels) {
		t.Fatal("a full-square polygon must fill the tiles completely, like the square tiling")
	}
}

func TestCustomRingLeavesAHole(t *testing.T) {
	inner := [][2]float64{{0.3, 0.3}, {0.7, 0.3}, {0.7, 0.7}, {0.3, 0.7}}
	c, err := shapes.Tessellate(80, 80, custom(unitSquare, [][][2]float64{inner}))
	if err != nil {
		t.Fatal(err)
	}
	// the centre of the first tile (pixel 10,10) is inside the inner ring: a hole, label 0; the tile's corner is solid
	if c.Labels[10*80+10] != 0 {
		t.Fatal("the middle of the tile should be a hole")
	}
	if c.Labels[1*80+1] == 0 {
		t.Fatal("the tile's corner should be filled")
	}
	if c.Count != 16 {
		t.Fatalf("%d cells, want 16 (the hole does not change the cell count)", c.Count)
	}
}

func TestCustomTwoPiecesOneCell(t *testing.T) {
	left := [][2]float64{{0.05, 0.1}, {0.4, 0.1}, {0.05, 0.9}}
	right := [][2]float64{{0.6, 0.1}, {0.95, 0.1}, {0.95, 0.9}}
	c, err := shapes.Tessellate(80, 80, custom(left, [][][2]float64{right}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Count != 16 {
		t.Fatalf("%d cells, want one per tile (16)", c.Count)
	}
	// along the middle row of the first tile there are two separate runs of the same id, with a gap between them
	var runs int
	prev := uint16(0)
	for x := 0; x < 20; x++ {
		l := c.Labels[10*80+x]
		if l != 0 && prev == 0 {
			runs++
		}
		if l != 0 && l != 1 {
			t.Fatalf("pixel %d has id %d, want 1", x, l)
		}
		prev = l
	}
	if runs != 2 {
		t.Fatalf("%d separate pieces in the first tile, want 2", runs)
	}
}

func TestCustomStaggerShiftsOddRows(t *testing.T) {
	plain := custom(unitSquare, nil)
	stag := custom(unitSquare, nil)
	stag.Stagger = true
	a, _ := shapes.Tessellate(80, 80, plain)
	b, _ := shapes.Tessellate(80, 80, stag)
	// even row 0: identical; odd row 1 (pixels 20..39): shifted by half a tile (10 px)
	if !slices.Equal(a.Labels[:20*80], b.Labels[:20*80]) {
		t.Fatal("row 0 must not move")
	}
	row := func(c shapes.Cells, y int) []uint16 { return c.Labels[y*80 : y*80+80] }
	ra, rb := row(a, 25), row(b, 25)
	boundary := func(r []uint16) int {
		for x := 1; x < 80; x++ {
			if r[x] != r[x-1] {
				return x
			}
		}
		return -1
	}
	if boundary(ra) != 20 || boundary(rb) != 10 {
		t.Fatalf("first cell boundary on an odd row: plain %d (want 20), staggered %d (want 10)", boundary(ra), boundary(rb))
	}
}

func TestCustomRejectsBadInput(t *testing.T) {
	many := make([][2]float64, 2001)
	for i := range many {
		many[i] = [2]float64{0.1, 0.2}
	}
	for name, tl := range map[string]shapes.Tiling{
		"two points":       custom([][2]float64{{0, 0}, {1, 1}}, nil),
		"NaN":              custom([][2]float64{{math.NaN(), 0}, {1, 0}, {0, 1}}, nil),
		"infinite":         custom([][2]float64{{math.Inf(1), 0}, {1, 0}, {0, 1}}, nil),
		"far outside":      custom([][2]float64{{9, 0}, {1, 0}, {0, 1}}, nil),
		"2001 points":      custom(many, nil),
		"short extra ring": custom(unitSquare, [][][2]float64{{{0.1, 0.1}, {0.2, 0.2}}}),
		"no polygon":       custom(nil, nil),
	} {
		if _, err := shapes.Tessellate(80, 80, tl); !errors.Is(err, shapes.ErrTiling) {
			t.Errorf("%s: got %v", name, err)
		}
	}
}

func TestProp_CustomConvexPolygon(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// a regular polygon with 3..12 corners, radius 0.1..0.5, centred in the tile
		n := rapid.IntRange(3, 12).Draw(t, "corners")
		r := rapid.Float64Range(0.1, 0.5).Draw(t, "radius")
		poly := make([][2]float64, n)
		for i := range poly {
			a := 2 * math.Pi * float64(i) / float64(n)
			poly[i] = [2]float64{0.5 + r*math.Cos(a), 0.5 + r*math.Sin(a)}
		}
		c, err := shapes.Tessellate(80, 80, custom(poly, nil))
		if err != nil {
			t.Fatal(err)
		}
		checkInvariants(t, 80, 80, c)
		area := 0
		for _, l := range c.Labels {
			if l != 0 {
				area++
			}
		}
		if area == 0 || area > 80*80 {
			t.Fatalf("labelled area %d", area)
		}
	})
}
