package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"pgregory.net/rapid"
)

// TestProp_RegionPartition is the region version of the partition property: every pixel once, every line inside
// a single cell, and every line holds a single class.
func TestProp_RegionPartition(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 40).Draw(t, "w")
		h := rapid.IntRange(1, 40).Draw(t, "h")
		regions := regionsGen(w, h).Draw(t, "regions")
		angle := rapid.IntRange(0, 359).Draw(t, "angle")
		L := engine.PartitionRegions(w, h, angle, regions)
		checkRegionPartition(t, w, h, regions, L)
	})
}

// TestRegionPartitionAcrossConfigurations ports the mockup's 56-configuration sweep: 7 cell sizes x 4 class
// patterns x 2 image sizes, each class walked at its own angle, some frozen. The real tessellations arrive in
// phase 7; a grid of square cells exercises the same code path until then.
func TestRegionPartitionAcrossConfigurations(t *testing.T) {
	sizes := [][2]int{{40, 30}, {7, 11}}
	cellSizes := []int{2, 3, 4, 5, 6, 8, 10}
	patterns := []string{"checker", "thirds", "all", "random"}
	n := 0
	for _, sz := range sizes {
		w, h := sz[0], sz[1]
		for _, cs := range cellSizes {
			for _, pat := range patterns {
				n++
				cells := gridCells(w, h, cs)
				classOf := classPattern(maxCellID(cells), pat, uint32(n))
				defs := make([]engine.ClassDef, len(classOf))
				for c := 1; c < len(defs); c++ {
					angle := (c*37 + n*11) % 360
					defs[c] = engine.ClassDef{Angle: &angle}
					if c%3 == 0 {
						defs[c].Frozen = true
					}
				}
				regions := &engine.Regions{Labels: cells, ClassOf: classOf, Defs: defs}
				if err := regions.Validate(w, h); err != nil {
					t.Fatalf("config %d (%dx%d, cells %d, %s): %v", n, w, h, cs, pat, err)
				}
				L := engine.PartitionRegions(w, h, (n*7)%360, regions)
				checkRegionPartition(t, w, h, regions, L)
			}
		}
	}
	if n != 56 {
		t.Fatalf("ran %d configurations, want 56", n)
	}
}

// testHelper is the slice of testing.TB that *testing.T and *rapid.T share, so one checker serves both.
type testHelper interface {
	Helper()
	Fatalf(format string, args ...any)
}

// checkRegionPartition asserts the three region invariants for one partition.
func checkRegionPartition(t testHelper, w, h int, regions *engine.Regions, lines engine.Lines) {
	t.Helper()
	if len(lines.P) != w*h {
		t.Fatalf("%dx%d: %d pixels, want %d", w, h, len(lines.P), w*h)
	}
	seen := make([]bool, w*h)
	for _, p := range lines.P {
		if p < 0 || int(p) >= w*h {
			t.Fatalf("position %d outside the image", p)
		}
		if seen[p] {
			t.Fatalf("position %d appears twice", p)
		}
		seen[p] = true
	}
	for l := 0; l < len(lines.Starts)-1; l++ {
		line := lines.P[lines.Starts[l]:lines.Starts[l+1]]
		cell := regions.Labels[line[0]]
		class := regions.ClassOf[cell]
		for _, p := range line {
			if regions.Labels[p] != cell {
				t.Fatalf("line %d crosses cells %d and %d", l, cell, regions.Labels[p])
			}
			if regions.ClassOf[regions.Labels[p]] != class {
				t.Fatalf("line %d holds two classes", l)
			}
		}
	}
}

// regionsGen draws a valid region map: a grid of square cells, 1..4 classes, each class with its own angle.
// It moves to internal/testutil in P1-T07.
func regionsGen(w, h int) *rapid.Generator[*engine.Regions] {
	patterns := []string{"checker", "thirds", "all", "random"}
	return rapid.Custom(func(t *rapid.T) *engine.Regions {
		cells := gridCells(w, h, rapid.IntRange(1, 12).Draw(t, "cellSize"))
		classOf := classPattern(maxCellID(cells), rapid.SampledFrom(patterns).Draw(t, "pattern"), rapid.Uint32().Draw(t, "seed"))
		defs := make([]engine.ClassDef, len(classOf))
		for c := 1; c < len(defs); c++ {
			angle := rapid.IntRange(0, 359).Draw(t, "classAngle")
			defs[c] = engine.ClassDef{Angle: &angle, Frozen: rapid.Bool().Draw(t, "frozen")}
		}
		return &engine.Regions{Labels: cells, ClassOf: classOf, Defs: defs}
	})
}

// gridCells numbers the squares of a size x size grid from 1, row by row. Cell 0 is unused, which is what the
// real tessellations reserve for the gaps between shapes.
func gridCells(w, h, size int) []uint16 {
	if size < 1 {
		size = 1
	}
	cw := (w + size - 1) / size
	out := make([]uint16, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			out[y*w+x] = uint16((y/size)*cw + x/size + 1)
		}
	}
	return out
}

func maxCellID(cells []uint16) int {
	m := 0
	for _, c := range cells {
		m = max(m, int(c))
	}
	return m
}

// classPattern assigns a class (1..4) to every cell id; index 0 is class 0.
func classPattern(cells int, pattern string, seed uint32) []uint8 {
	out := make([]uint8, cells+1)
	for id := 1; id <= cells; id++ {
		switch pattern {
		case "all":
			out[id] = 1
		case "checker":
			out[id] = uint8(id%2 + 1)
		case "thirds":
			out[id] = uint8(min(3, (id-1)*3/max(1, cells)+1))
		default: // "random": a tiny integer hash, so the test needs no RNG plumbing
			h := uint32(id)*2654435761 + seed*40503
			out[id] = uint8(h>>13)%4 + 1
		}
	}
	return out
}
