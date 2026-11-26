package shapes

import (
	"fmt"

	"github.com/AutumnsGrove/pixelsort-go/engine/patterns"
)

// A pattern shape is a generative pattern used as a stencil: engine/patterns draws a 0/1 plane, the unpainted areas
// become the cells that sort, and the painted lines become the gaps between them. It is the same object as a tiling —
// labels, cells, classes, cards — which is the point: a pattern decides what the shapes are, not where the sort
// intervals start (decision E13).

// patternSpec is the patterns.Spec a Tiling asks for. The tiling's own fields carry the knobs, because they mean the
// same thing: Size is the pattern's cell, Gap its line thickness, Rotate its turn and Seed its seed, all per mille of
// the picture width like every other spatial parameter (decision E4).
func patternSpec(w int, t Tiling) patterns.Spec {
	return patterns.Spec{
		Family: t.Family, Variant: t.Variant, Seed: t.Seed,
		Cell: t.Size, Thickness: t.Gap, Rotate: ((t.Rotate % 360) + 360) % 360,
		Detail: t.Detail, Invert: t.Invert, Width: w,
	}
}

// PatternPlane draws a pattern shape as a 0/1 plane over a w x h picture, 1 where the pattern paints a line. A pattern
// shape is a mask over the picture rather than a set of sort lines, so there is no line space to choose: the picture
// is what the pattern is laid over, and Rotate turns it.
func PatternPlane(w, h int, t Tiling) ([]uint8, error) {
	if w < 1 || h < 1 || w > 1<<14 || h > 1<<14 {
		return nil, fmt.Errorf("shapes: pattern: %dx%d picture: %w", w, h, ErrTiling)
	}
	if t.Shape != Pattern {
		return nil, fmt.Errorf("shapes: pattern: %q is not a pattern: %w", t.Shape, ErrTiling)
	}
	m, err := patterns.Mask(w, h, patternSpec(w, t))
	if err != nil {
		// The spec's own error names the knob and its range; ErrTiling is what a caller of this package can match.
		return nil, fmt.Errorf("shapes: pattern: %w (%w)", ErrTiling, err)
	}
	return m, nil
}

// PatternPreview shows what a pattern shape looks like on a w x h canvas as a 0/1 mask of its cells, and it is built
// from the same tessellation the picture uses, never a second copy. It draws the cells (the areas that sort), so it
// turns with Invert exactly the way the picture does.
func PatternPreview(w, h int, t Tiling) ([]uint8, error) {
	out, err := PatternPlane(w, h, t)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i] ^= 1 // the plane marks the painted lines; a preview shows the cells
	}
	return out, nil
}

// patternCells rasterises a pattern shape into cells. Painted pixels keep label 0 (the gap), which the class table
// freezes by default, exactly as a tiling's seams do.
func patternCells(w, h int, t Tiling) (Cells, error) {
	plane, err := PatternPlane(w, h, t)
	if err != nil {
		return Cells{}, err
	}
	// The pattern's cell in pixels is the bucket the class pattern (checker, thirds) runs on, so cells that belong to
	// the same tile of the drawing land in the same bucket.
	return cellsFromPlane(w, h, max(1, pixels(w, t.Size)), plane)
}

// cellsFromPlane labels every unpainted (0) area of a w x h plane as one cell, numbered 1..Count in raster order of
// each area's first pixel — the same first-seen order a tiling numbers its cells in. Areas are 4-connected: two areas
// that only meet at a corner are separate shapes, because the painted line passes between them.
//
// cell is the pattern's cell size in pixels; a cell's CI, CJ are the grid coordinates of its middle, so the class
// pattern alternates over the pattern's own tiles rather than over an arbitrary cell id.
func cellsFromPlane(w, h, cell int, plane []uint8) (Cells, error) {
	n := w * h
	if len(plane) != n {
		return Cells{}, fmt.Errorf("shapes: %d plane bytes for a %dx%d picture: %w", len(plane), w, h, ErrTiling)
	}
	labels := make([]uint16, n)
	ci, cj := []int32{0}, []int32{0}
	stack := make([]int32, 0, 1024)
	for start := 0; start < n; start++ {
		// A queued pixel already carries its id, and a painted pixel is never a cell, so 0 and plane 0 mean "new".
		if plane[start] != 0 || labels[start] != 0 {
			continue
		}
		if len(ci) > MaxCells {
			return Cells{}, fmt.Errorf("shapes: pattern: more than %d cells; use a larger size: %w", MaxCells, ErrTiling)
		}
		id := uint16(len(ci)) //nolint:gosec // bounded by MaxCells, and uint16 holds every id below it
		x0, y0 := start%w, start/w
		minX, maxX, minY, maxY := x0, x0, y0, y0
		labels[start] = id
		stack = append(stack[:0], int32(start)) //nolint:gosec // G115: the picture has at most 1<<28 pixels
		for len(stack) > 0 {
			p := int(stack[len(stack)-1])
			stack = stack[:len(stack)-1]
			x, y := p%w, p/w
			for _, d := range [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}} {
				nx, ny := x+d[0], y+d[1]
				if nx < 0 || nx >= w || ny < 0 || ny >= h {
					continue
				}
				q := ny*w + nx
				if plane[q] != 0 || labels[q] != 0 {
					continue
				}
				labels[q] = id
				stack = append(stack, int32(q)) //nolint:gosec // G115: a pixel position is below 1<<28
				minX, maxX = min(minX, nx), max(maxX, nx)
				minY, maxY = min(minY, ny), max(maxY, ny)
			}
		}
		ci = append(ci, int32((minX+maxX)/2/cell)) //nolint:gosec // G115: below 1<<14, and cell is at least 1
		cj = append(cj, int32((minY+maxY)/2/cell)) //nolint:gosec // G115: below 1<<14, and cell is at least 1
	}
	return Cells{Labels: labels, CI: ci, CJ: cj, Count: len(ci) - 1}, nil
}
