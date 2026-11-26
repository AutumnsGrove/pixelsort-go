package engine

// cutSegments fills dst with the segment boundaries of one run of unfrozen pixels, [r0, r1), as offsets within the
// line. Every mode is integer arithmetic (decision E6) and every random draw comes from the line's stream.
func (pl *Plan) cutSegments(dst [][2]int, line, lineStart, r0, r1 int, cp Params, rng *RNG, edges []uint8) [][2]int {
	mean := max(3, pixels(cp.Length, pl.W))
	switch cp.Mode {
	case ModeRandom:
		return cutRandom(dst, r0, r1, mean, rng)
	case ModeWave:
		return cutWave(dst, lineStart, r0, r1, line, cp, mean, pl.W, rng)
	case ModeEdges:
		return cutEdges(dst, pl.Lines.P, r0, r1, edges, cp.Edge)
	case ModeCA:
		return cutRising(dst, pl.Lines.P, r0, r1, pl.ca.mask(cp))
	case ModeCAEdges:
		return cutEdges(dst, pl.Lines.P, r0, r1, pl.ca.edgeMap(cp), cp.Edge)
	default: // ModeNone, ModeThreshold: the run between two frozen pixels is the interval (decision E7)
		return append(dst, [2]int{r0, r1})
	}
}

// cutRandom cuts widths of mean 2*mean+1 scaled by a draw, so the widths average `mean` rather than half of it.
func cutRandom(dst [][2]int, r0, r1, mean int, rng *RNG) [][2]int {
	for c := r0; c < r1; {
		width := max(2, int(rng.Uint32n(uint32((2*mean+1)&0xffffffff))))
		e := min(r1, c+width)
		dst = append(dst, [2]int{c, e})
		c = e
	}
	return dst
}

// cutWave is cutRandom with the width modulated by an integer sine along the line (decision E7):
//
//	factor = 1000 + WaveAmp*10*Sin1000(phase)/1000     -> 300..1700 for the default amplitude
//	width  = mean*factor/1000 * (900 + Uint32n(201))/1000
//
// pos is the offset within the line, and the line number is folded into the phase so neighbouring lines do not
// pulse in lockstep.
func cutWave(dst [][2]int, lineStart, r0, r1, line int, cp Params, mean, imgW int, rng *RNG) [][2]int {
	periodPx := 6 * mean
	if cp.WavePeriod != 0 {
		periodPx = pixels(cp.WavePeriod, imgW)
	}
	periodPx = max(8, periodPx)
	for c := r0; c < r1; {
		pos := c - lineStart
		phase := uint32((pos*65536/periodPx + line*11) & 0xFFFF)
		factor := 1000 + cp.WaveAmp*10*int(Sin1000(phase))/1000
		w := mean * factor / 1000
		w = w * (900 + int(rng.Uint32n(201))) / 1000
		w = max(2, w)
		e := min(r1, c+w)
		dst = append(dst, [2]int{c, e})
		c = e
	}
	return dst
}

// cutEdges cuts before the first pixel of every run of edge pixels, so an edge keeps its own pixels together
// instead of being sorted into the flat area beside it (PLAN.md 3.3, decision E7).
func cutEdges(dst [][2]int, line []int32, r0, r1 int, edges []uint8, limit int) [][2]int {
	c := r0
	for u := r0 + 1; u < r1; u++ {
		if int(edges[line[u]]) > limit && int(edges[line[u-1]]) <= limit {
			dst = append(dst, [2]int{c, u})
			c = u
		}
	}
	return append(dst, [2]int{c, r1})
}

// cutRising cuts before each pixel where the CA mask turns on, so the pixel that turns it on starts the new
// interval and takes part in it: a cut, not a freeze (PLAN.md 3.3).
func cutRising(dst [][2]int, line []int32, r0, r1 int, mask []uint8) [][2]int {
	c := r0
	for u := r0 + 1; u < r1; u++ {
		if mask[line[u]] != 0 && mask[line[u-1]] == 0 {
			dst = append(dst, [2]int{c, u})
			c = u
		}
	}
	return append(dst, [2]int{c, r1})
}
