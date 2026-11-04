package engine

// Feather returns a soft alpha plane: the hard mask (any non-zero becomes 255) blurred with a separable box filter
// of the given radius in pixels, window 2r+1, edges replicated, rounded to nearest. It is the Soft option of a plan
// (decision E11). radius <= 0 returns the hard mask itself.
//
// mask must hold exactly w*h bytes and w, h must be positive. Feather has no error return, so a mismatch is a
// programmer error and panics; whoever accepts a mask from outside (the session API) checks its length first.
//
// The mask stays a hard barrier for sorting; this plane only decides how much of the sorted result is blended back
// toward the original, so a feathered edge fades rather than stops.
func Feather(mask []uint8, w, h, radius int) []uint8 {
	out := make([]uint8, w*h)
	for i := range out {
		if mask[i] != 0 {
			out[i] = 255
		}
	}
	if radius <= 0 {
		return out
	}

	n := 2*radius + 1
	tmp := make([]uint8, w*h)
	// Horizontal pass: a sliding window keeps this O(w) per row rather than O(w*r).
	for y := 0; y < h; y++ {
		row := out[y*w : (y+1)*w]
		sum := 0
		for x := -radius; x <= radius; x++ {
			sum += int(row[clampTo(x, w-1)])
		}
		for x := 0; x < w; x++ {
			tmp[y*w+x] = uint8((sum + n/2) / n & 0xff)
			sum -= int(row[clampTo(x-radius, w-1)])
			sum += int(row[clampTo(x+radius+1, w-1)])
		}
	}
	// Vertical pass, over the horizontally blurred plane.
	for x := 0; x < w; x++ {
		at := func(y int) int { return int(tmp[clampTo(y, h-1)*w+x]) }
		sum := 0
		for y := -radius; y <= radius; y++ {
			sum += at(y)
		}
		for y := 0; y < h; y++ {
			out[y*w+x] = uint8((sum + n/2) / n & 0xff)
			sum -= at(y - radius)
			sum += at(y + radius + 1)
		}
	}
	return out
}

// clampTo folds v into [0, hi], which is how the blur replicates the image edge.
func clampTo(v, hi int) int { return min(hi, max(0, v)) }
