package engine

import "math"

// axis is how a sort angle walks the image. The major axis and direction are chosen with integer comparisons,
// never with floats, so 45 and 135 degrees cannot flip on a rounding error (decision E3).
//
//	angles   0..45, 315..359  walk x, left to right
//	angles 135..225           walk x, right to left
//	angles  46..134           walk y, bottom to top   (90 is bottom to top)
//	angles 226..314           walk y, top to bottom   (270 is top to bottom)
type axis struct {
	xMajor bool
	sign   int   // +1 walk up the index, -1 walk down it
	m16    int64 // slope as 16.16 fixed point: minor = k + ((major*m16 + 32768) >> 16)
}

func axisFor(angle int) axis {
	a := ((angle % 360) + 360) % 360
	xMajor := a <= 45 || a >= 315 || (a >= 135 && a <= 225)
	sign := 1
	if xMajor {
		if a > 45 && a < 315 {
			sign = -1
		}
	} else if a > 45 && a < 135 {
		sign = -1
	}
	var m float64 // the only float in the geometry; computed once per angle; every product is wrapped in float64()
	if a%90 != 0 {
		s, c := math.Sincos(float64(a) * math.Pi / 180)
		dx, dy := float64(c), -float64(s) // screen coordinates: y grows downward
		if xMajor {
			m = float64(dy / dx)
		} else {
			m = float64(dx / dy)
		}
	}
	return axis{xMajor, sign, int64(math.Floor(float64(m*65536) + 0.5))}
}

func roundMul(major int, m16 int64) int { return int((int64(major)*m16 + 32768) >> 16) }

// Lines holds every pixel exactly once, grouped into staircase lines in walking order:
// line l is P[Starts[l]:Starts[l+1]]. PLAN.md 3.2.
type Lines struct {
	P      []int32 // pixel positions (y*W + x), one per pixel
	Starts []int32 // len = number of lines + 1
}

// Partition splits a w x h image into lines for a sort angle in whole degrees. It is a pure permutation of the
// pixels, which is what makes the sort reversible and the stepper's last frame equal to the instant result.
// w*h must be at most MaxPixels: pixel positions are stored as int32.
func Partition(w, h, angle int) Lines {
	ax := axisFor(angle)
	P := make([]int32, 0, w*h)
	var starts []int32
	major, minor := w, h // walk along x: the line index k is a y offset
	if !ax.xMajor {
		major, minor = h, w
	}
	kmin, kmax := math.MaxInt, math.MinInt
	for _, a := range [2]int{0, major - 1} {
		for _, b := range [2]int{0, minor - 1} {
			k := b - roundMul(a, ax.m16)
			kmin, kmax = min(kmin, k), max(kmax, k)
		}
	}
	for k := kmin; k <= kmax; k++ {
		s0 := len(P)
		for i := 0; i < major; i++ {
			a := i
			if ax.sign < 0 {
				a = major - 1 - i
			}
			b := k + roundMul(a, ax.m16)
			if b < 0 || b >= minor {
				continue
			}
			if ax.xMajor {
				P = append(P, pos32(b*w+a))
			} else {
				P = append(P, pos32(a*w+b))
			}
		}
		if len(P) > s0 {
			starts = append(starts, pos32(s0))
		}
	}
	return Lines{P: P, Starts: append(starts, pos32(len(P)))}
}

// pos32 narrows a pixel count or position to int32. Every Image is at most MaxPixels (2^28) pixels, so a position
// always fits; Partition documents that requirement, and the conversion is deliberate rather than unchecked.
func pos32(pos int) int32 { return int32(pos) } //nolint:gosec // G115: positions are below MaxPixels = 2^28
