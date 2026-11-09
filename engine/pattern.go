package engine

import (
	"fmt"

	"github.com/AutumnsGrove/pixelsort-go/engine/patterns"
)

// MaxPatternPreview bounds the size of a pattern preview canvas on either side, so a caller cannot ask for a huge
// allocation.
const MaxPatternPreview = 1024

// patternKey identifies one generated mask: everything it depends on besides the lines and the seed.
type patternKey struct {
	family, variant                 string
	cell, thickness, rotate, detail int
	invert                          bool
	space                           string
}

// patternCache builds each distinct pattern mask (and its edge map) once per plan, however many classes use it.
type patternCache struct {
	pl    *Plan
	seed  uint32
	masks map[patternKey][]uint8
	edges map[patternKey][]uint8
}

func newPatternCache(pl *Plan, seed uint32) *patternCache {
	return &patternCache{pl: pl, seed: seed, masks: map[patternKey][]uint8{}, edges: map[patternKey][]uint8{}}
}

func patternKeyOf(cp Params) patternKey {
	return patternKey{
		family: cp.Pattern, variant: cp.PatternVariant, cell: cp.PatternCell, thickness: cp.PatternThickness,
		rotate: cp.PatternRotate, detail: cp.PatternDetail, invert: cp.PatternInvert, space: cp.CASpace,
	}
}

// mask returns the 0/1 pattern for a class's settings, per pixel position. The recipe was validated by NewPlan, so a
// pattern error here is impossible; it would mean Validate and patterns.Mask disagree.
func (c *patternCache) mask(cp Params) []uint8 {
	k := patternKeyOf(cp)
	if m, ok := c.masks[k]; ok {
		return m
	}
	spec := cp.patternSpec(c.pl.W)
	spec.Seed = c.seed
	var m []uint8
	var err error
	if cp.CASpace == CASpaceLine {
		longest := 0
		for l := 0; l+1 < len(c.pl.Lines.Starts); l++ {
			longest = max(longest, int(c.pl.Lines.Starts[l+1]-c.pl.Lines.Starts[l]))
		}
		nLines := len(c.pl.Lines.Starts) - 1
		m, err = patterns.Mask(longest, nLines, spec)
		if err == nil {
			m = patternMapLine(c.pl.Lines, c.pl.W, c.pl.H, longest, m)
		}
	} else {
		m, err = patterns.Mask(c.pl.W, c.pl.H, spec)
	}
	if err != nil {
		// Unreachable after Params.Validate; a zero mask keeps a broken recipe from taking the whole runtime down.
		m = make([]uint8, c.pl.W*c.pl.H)
	}
	c.masks[k] = m
	return m
}

// patternMapLine lays a pattern drawn over the sort lines (row = line number, column = index along the line) onto pixel
// positions, so the pattern turns with the sort angle.
func patternMapLine(l Lines, w, h, stride int, grid []uint8) []uint8 {
	out := make([]uint8, w*h)
	for line := 0; line+1 < len(l.Starts); line++ {
		start, end := int(l.Starts[line]), int(l.Starts[line+1])
		row := line * stride
		for i := start; i < end; i++ {
			out[l.P[i]] = grid[row+i-start]
		}
	}
	return out
}

// edgeMap returns the Laplacian edge map of the pattern scaled to 0/255, for pattern-edges.
func (c *patternCache) edgeMap(cp Params) []uint8 {
	k := patternKeyOf(cp)
	if e, ok := c.edges[k]; ok {
		return e
	}
	m := c.mask(cp)
	scaled := make([]uint8, len(m))
	for i, v := range m {
		scaled[i] = v * 255
	}
	e := EdgeMap(scaled, c.pl.W, c.pl.H)
	c.edges[k] = e
	return e
}

// PatternPreview draws what a recipe's pattern looks like on a small w x h canvas, as a 0/1 mask per pixel position:
// the same space, sort angle, cell size and seed the sort uses, laid out the same way (over the picture in image space,
// along the sort lines at the recipe's angle in line space). It is built from the sort's own mask code, never a second
// copy, so the panel's picture cannot drift from the real mask. It shows the pattern's texture, not the exact mask of a
// picture with a region map: a class may walk its lines at its own angle, and a stateless preview has no region map.
func PatternPreview(w, h int, p Params) ([]uint8, error) {
	if w < 1 || h < 1 || w > MaxPatternPreview || h > MaxPatternPreview {
		return nil, fmt.Errorf("engine: pattern preview size %dx%d is outside 1..%d", w, h, MaxPatternPreview)
	}
	if err := p.Validate(); err != nil {
		return nil, fmt.Errorf("engine: pattern preview: %w", err)
	}
	if p.Pattern == "" {
		return nil, fmt.Errorf("engine: pattern preview: no pattern")
	}
	pl := &Plan{W: w, H: h, Lines: Partition(w, h, p.Angle)}
	return newPatternCache(pl, p.Seed).mask(p), nil
}
