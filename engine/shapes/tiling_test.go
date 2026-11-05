package shapes_test

import (
	"errors"
	"math"
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/shapes"
	"pgregory.net/rapid"
)

func tile(shape string, size, gap, rotate int) shapes.Tiling {
	return shapes.Tiling{Shape: shape, Size: size, Gap: gap, Rotate: rotate, Seed: 1, Pattern: "all"}
}

func labelled(c shapes.Cells) int {
	n := 0
	for _, l := range c.Labels {
		if l != 0 {
			n++
		}
	}
	return n
}

func TestSquareKnownGrid(t *testing.T) {
	// 12x12 at size 500 per mille: S = max(6, (12*500+500)/1000) = 6, so four 6x6 cells, numbered in raster order of
	// their first pixel.
	c, err := shapes.Tessellate(12, 12, tile(shapes.Square, 500, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	if c.Count != 4 {
		t.Fatalf("%d cells, want 4", c.Count)
	}
	for y := 0; y < 12; y++ {
		for x := 0; x < 12; x++ {
			want := uint16((y/6)*2 + x/6 + 1)
			if got := c.Labels[y*12+x]; got != want {
				t.Fatalf("pixel (%d,%d) = %d, want %d", x, y, got, want)
			}
		}
	}
}

func TestGapLeavesSeams(t *testing.T) {
	c, err := shapes.Tessellate(12, 12, tile(shapes.Square, 500, 125, 0)) // gap = (12*125+500)/1000 = 2
	if err != nil {
		t.Fatal(err)
	}
	if c.Count != 4 {
		t.Fatalf("%d cells", c.Count)
	}
	// each 6x6 cell keeps a 4x4 core (inset by gap/2 = 1 on every side), so 16 pixels per cell
	if labelled(c) != 4*16 {
		t.Fatalf("%d labelled pixels, want 64", labelled(c))
	}
	if c.Labels[0] != 0 || c.Labels[2*12+2] == 0 {
		t.Fatal("the outer ring of a cell is seam; its core is labelled")
	}
}

func TestShapeCoverageOrder(t *testing.T) {
	area := map[string]int{}
	for _, s := range []string{shapes.Square, shapes.Octagon, shapes.Circle} {
		c, err := shapes.Tessellate(96, 96, tile(s, 250, 0, 0))
		if err != nil {
			t.Fatal(err)
		}
		area[s] = labelled(c)
	}
	if !(area[shapes.Circle] < area[shapes.Octagon] && area[shapes.Octagon] < area[shapes.Square]) {
		t.Fatalf("coverage %v: want circle < octagon < square", area)
	}
}

func TestRotationBy90KeepsCellShapes(t *testing.T) {
	a, _ := shapes.Tessellate(80, 80, tile(shapes.Square, 250, 0, 0))
	b, _ := shapes.Tessellate(80, 80, tile(shapes.Square, 250, 0, 90))
	sizes := func(c shapes.Cells) []int {
		n := make([]int, c.Count+1)
		for _, l := range c.Labels {
			n[l]++
		}
		slices.Sort(n)
		return n
	}
	if !slices.Equal(sizes(a), sizes(b)) {
		t.Fatalf("cell size multisets differ after a 90 degree turn:\n%v\n%v", sizes(a), sizes(b))
	}
}

func TestErrors(t *testing.T) {
	for name, tc := range map[string]struct {
		w, h int
		t    shapes.Tiling
	}{
		"unknown shape": {10, 10, tile("blob", 100, 0, 0)},
		"zero width":    {0, 10, tile(shapes.Square, 100, 0, 0)},
		"zero size":     {10, 10, tile(shapes.Square, 0, 0, 0)},
		"negative gap":  {10, 10, tile(shapes.Square, 100, -1, 0)},
	} {
		if _, err := shapes.Tessellate(tc.w, tc.h, tc.t); !errors.Is(err, shapes.ErrTiling) {
			t.Errorf("%s: got %v", name, err)
		}
	}
	// too many cells: the smallest cell is 6 px, so 2400x1200 would need 80,000
	if _, err := shapes.Tessellate(2400, 1200, tile(shapes.Square, 2, 0, 0)); !errors.Is(err, shapes.ErrTiling) {
		t.Errorf("too many cells: got %v", err)
	}
}

var allShapes = []string{shapes.Square, shapes.Diamond, shapes.Circle, shapes.Octagon, shapes.Hexagon, shapes.Triangle, shapes.Voronoi}

// failer is the part of testing.TB that checkInvariants needs, so rapid's T and testing's T both fit.
type failer interface {
	Helper()
	Fatalf(format string, args ...any)
}

func checkInvariants(t failer, w, h int, c shapes.Cells) {
	t.Helper()
	if len(c.Labels) != w*h || len(c.CI) != c.Count+1 || len(c.CJ) != c.Count+1 {
		t.Fatalf("lengths: %d labels for %dx%d, %d/%d coordinates for %d cells", len(c.Labels), w, h, len(c.CI), len(c.CJ), c.Count)
	}
	seen := make([]bool, c.Count+1)
	for _, l := range c.Labels {
		if int(l) > c.Count {
			t.Fatalf("label %d above count %d", l, c.Count)
		}
		seen[l] = true
	}
	for id := 1; id <= c.Count; id++ {
		if !seen[id] {
			t.Fatalf("cell id %d never occurs: ids must be contiguous 1..%d", id, c.Count)
		}
	}
}

func TestProp_Tessellate(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 90).Draw(t, "w")
		h := rapid.IntRange(1, 90).Draw(t, "h")
		tl := shapes.Tiling{
			Shape: rapid.SampledFrom(allShapes).Draw(t, "shape"), Size: rapid.IntRange(10, 1000).Draw(t, "size"),
			Gap: rapid.IntRange(0, 200).Draw(t, "gap"), Rotate: rapid.IntRange(0, 359).Draw(t, "rotate"), Seed: rapid.Uint32().Draw(t, "seed"),
		}
		c, err := shapes.Tessellate(w, h, tl)
		if err != nil {
			t.Fatalf("%+v: %v", tl, err)
		}
		checkInvariants(t, w, h, c)
		again, _ := shapes.Tessellate(w, h, tl)
		if !slices.Equal(c.Labels, again.Labels) {
			t.Fatal("not deterministic")
		}
	})
}

func TestHexagonCentreAndCount(t *testing.T) {
	const w, h = 200, 200
	c, err := shapes.Tessellate(w, h, tile(shapes.Hexagon, 100, 0, 0)) // S = 20
	if err != nil {
		t.Fatal(err)
	}
	if c.Labels[(h/2)*w+w/2] == 0 {
		t.Fatal("the centre pixel is in no cell at gap 0")
	}
	// a hexagon with circumradius R = 10 has area 3*sqrt(3)/2 * R^2
	hexArea := 3 * math.Sqrt(3) / 2 * 100
	want := float64(w*h) / hexArea
	if got := float64(c.Count); got < want*0.8 || got > want*1.35 {
		t.Fatalf("%d hexagons, expected about %.0f", c.Count, want)
	}
	// six neighbours around an interior cell: count the distinct ids touching the centre cell's pixels
	centre := c.Labels[(h/2)*w+w/2]
	neigh := map[uint16]bool{}
	for y := 1; y < h-1; y++ {
		for x := 1; x < w-1; x++ {
			if c.Labels[y*w+x] != centre {
				continue
			}
			for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				if n := c.Labels[(y+d[1])*w+x+d[0]]; n != centre && n != 0 {
					neigh[n] = true
				}
			}
		}
	}
	if len(neigh) != 6 {
		t.Fatalf("centre hexagon touches %d neighbours, want 6", len(neigh))
	}
}

func TestTriangleParallelogramSplitsInTwo(t *testing.T) {
	c, err := shapes.Tessellate(120, 120, tile(shapes.Triangle, 200, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	// triangle cells share (CJ, CI/2): both halves of one parallelogram have the same pair
	halves := map[[2]int32]map[int32]bool{}
	for id := 1; id <= c.Count; id++ {
		k := [2]int32{c.CI[id] / 2, c.CJ[id]}
		if halves[k] == nil {
			halves[k] = map[int32]bool{}
		}
		halves[k][c.CI[id]%2] = true
	}
	for k, h := range halves {
		if len(h) > 2 {
			t.Fatalf("parallelogram %v has %d halves", k, len(h))
		}
	}
	if len(halves) == 0 || c.Count < len(halves) {
		t.Fatalf("%d cells in %d parallelograms", c.Count, len(halves))
	}
}

func TestVoronoiMatchesBruteForce(t *testing.T) {
	const w, h = 40, 40
	tl := tile(shapes.Voronoi, 300, 0, 0)
	c, err := shapes.Tessellate(w, h, tl)
	if err != nil {
		t.Fatal(err)
	}
	checkInvariants(t, w, h, c)
	sites := shapes.VoronoiSitesForTest(w, h, tl)
	// every pixel carries the id of its nearest site; ids are numbered by first-seen pixel, so compare partitions
	siteOf := map[uint16]int{}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			best, bd := 0, math.Inf(1)
			for i, s := range sites {
				dx, dy := float64(x)-s[0], float64(y)-s[1]
				if d := dx*dx + dy*dy; d < bd {
					best, bd = i, d
				}
			}
			l := c.Labels[y*w+x]
			if prev, ok := siteOf[l]; ok && prev != best {
				t.Fatalf("pixel (%d,%d): label %d is also nearest-site %d, now %d", x, y, l, prev, best)
			}
			siteOf[l] = best
		}
	}
	if len(siteOf) != c.Count {
		t.Fatalf("%d labels matched to sites, %d cells", len(siteOf), c.Count)
	}
}

func TestVoronoiSeedsAndGap(t *testing.T) {
	a, _ := shapes.Tessellate(60, 60, tile(shapes.Voronoi, 250, 0, 0))
	b, _ := shapes.Tessellate(60, 60, tile(shapes.Voronoi, 250, 0, 0))
	other := tile(shapes.Voronoi, 250, 0, 0)
	other.Seed = 2
	d, _ := shapes.Tessellate(60, 60, other)
	if !slices.Equal(a.Labels, b.Labels) || slices.Equal(a.Labels, d.Labels) {
		t.Fatal("same seed must repeat and a different seed must differ")
	}
	if labelled(a) != 60*60 {
		t.Fatal("with gap 0 every pixel belongs to a cell")
	}
	g, _ := shapes.Tessellate(60, 60, tile(shapes.Voronoi, 250, 50, 0))
	if labelled(g) >= labelled(a) || labelled(g) == 0 {
		t.Fatalf("a gap should carve seams: %d vs %d", labelled(g), labelled(a))
	}
}

func TestClassify(t *testing.T) {
	c, _ := shapes.Tessellate(40, 40, tile(shapes.Square, 250, 0, 0)) // 4x4 cells of 10
	checker := shapes.Classify(c, shapes.PatternChecker, 0, 1)
	if checker[0] != 0 {
		t.Fatal("cell 0 must stay class 0")
	}
	for id := 1; id <= c.Count; id++ {
		want := uint8(1 + ((c.CI[id]+c.CJ[id])%2+2)%2)
		if checker[id] != want {
			t.Fatalf("checker cell %d (%d,%d) = %d, want %d", id, c.CI[id], c.CJ[id], checker[id], want)
		}
	}
	all := shapes.Classify(c, shapes.PatternAll, 0, 1)
	thirds := shapes.Classify(c, shapes.PatternThirds, 0, 1)
	rnd := shapes.Classify(c, shapes.PatternRandom, 4, 9)
	used := map[uint8]bool{}
	for id := 1; id <= c.Count; id++ {
		if all[id] != 1 || thirds[id] < 1 || thirds[id] > 3 || rnd[id] < 1 || rnd[id] > 4 {
			t.Fatalf("cell %d: all %d thirds %d random %d", id, all[id], thirds[id], rnd[id])
		}
		used[rnd[id]] = true
	}
	if len(used) < 3 {
		t.Fatalf("random with 4 kinds over %d cells used only %d classes", c.Count, len(used))
	}
	if !slices.Equal(rnd, shapes.Classify(c, shapes.PatternRandom, 4, 9)) {
		t.Fatal("random is not deterministic")
	}
}

func FuzzTessellate(f *testing.F) {
	f.Add(uint8(50), uint8(40), uint8(2), uint16(300), uint8(10), uint16(30))
	f.Add(uint8(1), uint8(1), uint8(6), uint16(10), uint8(0), uint16(0))
	f.Fuzz(func(t *testing.T, w, h, shapeIdx uint8, size uint16, gap uint8, rotate uint16) {
		tl := shapes.Tiling{Shape: allShapes[int(shapeIdx)%len(allShapes)], Size: int(size)%990 + 10, Gap: int(gap) % 200, Rotate: int(rotate) % 360, Seed: uint32(size)}
		ww, hh := int(w)%90+1, int(h)%90+1
		c, err := shapes.Tessellate(ww, hh, tl)
		if err != nil {
			return // too many cells is an error, never a panic
		}
		if c.Count > shapes.MaxCells {
			t.Fatalf("%d cells", c.Count)
		}
		checkInvariants(t, ww, hh, c)
	})
}
