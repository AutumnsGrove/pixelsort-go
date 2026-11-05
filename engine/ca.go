package engine

// Elementary one-dimensional cellular automata (Wolfram rules 0..255) as interval masks (PLAN.md 3.6, decision E7).
// A mask is a plane of 0/1 made from a grid of cells; where it turns on along a sort line, a new interval starts.

// CABoundary is how a CA row treats its ends.
type CABoundary = string

// caRows runs rule for `rows` rows (row 0 is a copy of first) and returns them all. Neighbours past the ends depend
// on b: fixed treats them as 0, wrap makes the row a ring, random draws the two edge cells of every later row fresh
// from rng, in the order left edge, then right edge, before the interior is computed (so draw order is stable).
func caRows(first []uint8, rows int, rule uint8, b CABoundary, rng *RNG) [][]uint8 {
	w := len(first)
	out := make([][]uint8, rows)
	if rows == 0 {
		return out
	}
	out[0] = append([]uint8(nil), first...)
	at := func(prev []uint8, x int) uint8 {
		if x < 0 || x >= w {
			if b == CABoundaryWrap {
				return prev[(x+w)%w]
			}
			return 0
		}
		return prev[x]
	}
	for y := 1; y < rows; y++ {
		prev, row := out[y-1], make([]uint8, w)
		for x := 0; x < w; x++ {
			idx := at(prev, x-1)<<2 | at(prev, x)<<1 | at(prev, x+1)
			row[x] = (rule >> idx) & 1
		}
		if b == CABoundaryRandom {
			row[0] = uint8(rng.Uint32n(2) & 1)
			row[w-1] = uint8(rng.Uint32n(2) & 1)
		}
		out[y] = row
	}
	return out
}

// CAGrid returns the cw x ch grid of cells for a rule. The first row is random, from NewStream(seed, 0xCA000000|rule),
// and the same stream feeds random boundaries, so the grid depends only on its arguments.
func CAGrid(cw, ch int, rule uint8, b CABoundary, seed uint32) [][]uint8 {
	if cw < 1 || ch < 1 {
		return nil
	}
	rng := NewStream(seed, 0xCA000000|uint32(rule))
	first := make([]uint8, cw)
	for i := range first {
		first[i] = uint8(rng.Uint32n(2) & 1)
	}
	return caRows(first, ch, rule, b, rng)
}

// CAMapImage expands a grid to a w*h mask in image space by nearest neighbour: each cell becomes a cellPx square and
// the last block is clipped by the image edge. No filter, so the mask stays strictly 0 or 1.
func CAMapImage(w, h, cellPx int, grid [][]uint8) []uint8 {
	out := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		row := grid[min(len(grid)-1, y/cellPx)]
		for x := 0; x < w; x++ {
			out[y*w+x] = row[min(len(row)-1, x/cellPx)]
		}
	}
	return out
}

// caMapLine lays the grid over the sort lines instead of the picture: row = line / cellPx, column = index along the
// line / cellPx, so the pattern turns with the sort angle. The result is indexed by pixel position.
func caMapLine(l Lines, w, h, cellPx int, grid [][]uint8) []uint8 {
	out := make([]uint8, w*h)
	for line := 0; line+1 < len(l.Starts); line++ {
		row := grid[min(len(grid)-1, line/cellPx)]
		start := int(l.Starts[line])
		for i := start; i < int(l.Starts[line+1]); i++ {
			out[l.P[i]] = row[min(len(row)-1, (i-start)/cellPx)]
		}
	}
	return out
}

// caKey identifies one generated mask: everything the mask depends on besides the lines and the seed.
type caKey struct {
	rule, cell int
	boundary   string
	space      string
}

// caCache builds each distinct CA mask (and its edge map) once per plan, however many classes use it.
type caCache struct {
	pl       *Plan
	seed     uint32
	override []uint8
	masks    map[caKey][]uint8
	edges    map[caKey][]uint8
}

func newCACache(pl *Plan, seed uint32, override []uint8) *caCache {
	return &caCache{pl: pl, seed: seed, override: override, masks: map[caKey][]uint8{}, edges: map[caKey][]uint8{}}
}

func keyOf(cp Params) caKey {
	return caKey{rule: cp.Rule, cell: cp.Cell, boundary: cp.CABoundary, space: cp.CASpace}
}

// mask returns the 0/1 mask for a class's CA settings, per pixel position.
func (c *caCache) mask(cp Params) []uint8 {
	if c.override != nil {
		return c.override
	}
	k := keyOf(cp)
	if m, ok := c.masks[k]; ok {
		return m
	}
	pl := c.pl
	cellPx := pixels(cp.Cell, pl.W)
	var m []uint8
	if cp.CASpace == CASpaceLine {
		longest := 0
		for l := 0; l+1 < len(pl.Lines.Starts); l++ {
			longest = max(longest, int(pl.Lines.Starts[l+1]-pl.Lines.Starts[l]))
		}
		cw, ch := (longest+cellPx-1)/cellPx, (len(pl.Lines.Starts)-1+cellPx-1)/cellPx
		m = caMapLine(pl.Lines, pl.W, pl.H, cellPx, CAGrid(cw, ch, uint8(cp.Rule&0xff), cp.CABoundary, c.seed))
	} else {
		cw, ch := (pl.W+cellPx-1)/cellPx, (pl.H+cellPx-1)/cellPx
		m = CAMapImage(pl.W, pl.H, cellPx, CAGrid(cw, ch, uint8(cp.Rule&0xff), cp.CABoundary, c.seed))
	}
	c.masks[k] = m
	return m
}

// edgeMap returns the Laplacian edge map of the mask scaled to 0/255, for ca-edges.
func (c *caCache) edgeMap(cp Params) []uint8 {
	k := keyOf(cp)
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
