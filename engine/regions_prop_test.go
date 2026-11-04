package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
	"pgregory.net/rapid"
)

// TestProp_RegionPartition is the region version of the partition property: every pixel once, every line inside
// a single cell, and every line holds a single class.
func TestProp_RegionPartition(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 40).Draw(t, "w")
		h := rapid.IntRange(1, 40).Draw(t, "h")
		regions := testutil.RegionsGen(w, h).Draw(t, "regions")
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
				cells := testutil.GridCells(w, h, cs)
				classOf := testutil.ClassPattern(maxCells(cells), pat, uint32(n))
				defs := make([]engine.ClassDef, maxClass(classOf)+1)
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

// maxCells and maxClass size the class table and the defs for a generated map; the helpers live in testutil for
// RegionsGen, and the sweep below needs the same two numbers.
func maxCells(cells []uint16) int {
	m := 0
	for _, c := range cells {
		m = max(m, int(c))
	}
	return m
}

func maxClass(classOf []uint8) int {
	m := 0
	for _, c := range classOf {
		m = max(m, int(c))
	}
	return m
}
