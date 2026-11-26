package shapes_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/shapes"
)

// patternTiling is a pattern shape with the knobs a person starts from.
func patternTiling(family, variant string, size, gap int) shapes.Tiling {
	return shapes.Tiling{
		Shape: shapes.Pattern, Size: size, Gap: gap, Rotate: 0, Seed: 3,
		Family: family, Variant: variant, Detail: 5, Pattern: "checker",
	}
}

// TestPatternCellsAreTheUnpaintedAreas: a pattern shape is a stencil, so every pixel of the picture is either a cell
// or one of the painted lines, and the lines keep label 0 (the gap the class table freezes). Cell ids are contiguous
// from 1, so every id the class table names is used.
func TestPatternCellsAreTheUnpaintedAreas(t *testing.T) {
	tl := patternTiling("truchet", "arc", 60, 8)
	c, err := shapes.Tessellate(120, 90, tl)
	if err != nil {
		t.Fatal(err)
	}
	plane, err := shapes.PatternPlane(120, 90, tl)
	if err != nil {
		t.Fatal(err)
	}
	if c.Count < 2 || len(c.Labels) != 120*90 || len(c.CI) != c.Count+1 || len(c.CJ) != c.Count+1 {
		t.Fatalf("%d cells, %d labels, %d/%d coordinates", c.Count, len(c.Labels), len(c.CI), len(c.CJ))
	}
	used := make([]bool, c.Count+1)
	for i, label := range c.Labels {
		if (label == 0) != (plane[i] != 0) {
			t.Fatalf("pixel %d: label %d, painted %d", i, label, plane[i])
		}
		if label > 0 {
			used[label] = true
		}
	}
	for id := 1; id <= c.Count; id++ {
		if !used[id] {
			t.Fatalf("cell %d is never used", id)
		}
	}
}

// TestPatternCellsFollowTheDrawing: the knobs reach the tessellation, so two drawings are two different region maps.
func TestPatternCellsFollowTheDrawing(t *testing.T) {
	base := patternTiling("truchet", "arc", 60, 8)
	labels := func(tl shapes.Tiling) []uint16 {
		c, err := shapes.Tessellate(120, 90, tl)
		if err != nil {
			t.Fatal(err)
		}
		return c.Labels
	}
	other := base
	other.Variant = "strand"
	if slices.Equal(labels(base), labels(other)) {
		t.Fatal("two truchet variants drew the same cells")
	}
	other = base
	other.Seed = 4
	if slices.Equal(labels(base), labels(other)) {
		t.Fatal("two seeds drew the same cells")
	}
	other = base
	other.Rotate = 33
	if slices.Equal(labels(base), labels(other)) {
		t.Fatal("a turn did not change the cells")
	}
}

// TestPatternInvertSwapsTheSides: Invert is the one knob that chooses which side of the drawing sorts, so the cells
// become exactly the painted lines and the drawn side becomes the gap.
func TestPatternInvertSwapsTheSides(t *testing.T) {
	tl := patternTiling("grid", "iso", 80, 10)
	plain, err := shapes.PatternPlane(100, 80, tl)
	if err != nil {
		t.Fatal(err)
	}
	tl.Invert = true
	flipped, err := shapes.PatternPlane(100, 80, tl)
	if err != nil {
		t.Fatal(err)
	}
	on := 0
	for i := range plain {
		if plain[i]+flipped[i] != 1 {
			t.Fatalf("pixel %d: %d and %d before and after inverting", i, plain[i], flipped[i])
		}
		on += int(plain[i])
	}
	if on == 0 {
		t.Fatal("the pattern painted nothing")
	}
	c, err := shapes.Tessellate(100, 80, tl)
	if err != nil {
		t.Fatal(err)
	}
	for i, label := range c.Labels {
		if (label == 0) != (flipped[i] != 0) {
			t.Fatalf("pixel %d: label %d, painted %d", i, label, flipped[i])
		}
	}
}

// TestPatternCellGridCoordinates: a cell's grid coordinates are its middle in units of the pattern's own cell, which is
// the grid the class pattern (checker, thirds) runs on.
func TestPatternCellGridCoordinates(t *testing.T) {
	const w, h, size = 120, 90, 40
	c, err := shapes.Tessellate(w, h, patternTiling("truchet", "arc", size, 8))
	if err != nil {
		t.Fatal(err)
	}
	cellPx := int32(max(1, (w*size+500)/1000))
	cols, rows := int32(w)/cellPx, int32(h)/cellPx
	for id := 1; id <= c.Count; id++ {
		if c.CI[id] < 0 || c.CI[id] > cols || c.CJ[id] < 0 || c.CJ[id] > rows {
			t.Fatalf("cell %d at grid (%d,%d), outside 0..%d x 0..%d", id, c.CI[id], c.CJ[id], cols, rows)
		}
	}
}

// TestPatternPreviewShowsTheCells: the panel's picture comes from the tessellation itself, so it marks exactly the
// pixels that sort, it is binary, and it needs a pattern shape.
func TestPatternPreviewShowsTheCells(t *testing.T) {
	tl := patternTiling("radial", "spiral", 60, 8)
	m, err := shapes.PatternPreview(64, 48, tl)
	if err != nil {
		t.Fatal(err)
	}
	c, err := shapes.Tessellate(64, 48, tl)
	if err != nil {
		t.Fatal(err)
	}
	for i, v := range m {
		if v > 1 {
			t.Fatalf("byte %d is %d", i, v)
		}
		if (c.Labels[i] != 0) != (v == 1) {
			t.Fatalf("pixel %d: preview %d, label %d: the preview must mark exactly the cells", i, v, c.Labels[i])
		}
	}
	again, _ := shapes.PatternPreview(64, 48, tl)
	if !slices.Equal(m, again) {
		t.Fatal("the preview is not deterministic")
	}
	if _, err := shapes.PatternPreview(64, 48, shapes.Tiling{Shape: shapes.Square, Size: 90}); !errors.Is(err, shapes.ErrTiling) {
		t.Fatalf("a square is not a pattern: %v", err)
	}
}

// TestPatternShapeRejectsBadKnobs: a pattern's ranges are the pattern package's, and a bad drawing is an error rather
// than a picture with no cells in it.
func TestPatternShapeRejectsBadKnobs(t *testing.T) {
	for name, tl := range map[string]shapes.Tiling{
		"unknown family":   patternTiling("spiral", "arc", 60, 8),
		"unknown variant":  patternTiling("truchet", "nope", 60, 8),
		"another family's": patternTiling("truchet", "mesh", 60, 8),
		"no line":          patternTiling("truchet", "arc", 60, 0),
		"size zero":        patternTiling("truchet", "arc", 0, 8),
		"detail zero":      func() shapes.Tiling { tl := patternTiling("radial", "spiral", 60, 8); tl.Detail = 0; return tl }(),
		"detail too big":   func() shapes.Tiling { tl := patternTiling("radial", "spiral", 60, 8); tl.Detail = 17; return tl }(),
	} {
		if _, err := shapes.Tessellate(40, 40, tl); !errors.Is(err, shapes.ErrTiling) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
