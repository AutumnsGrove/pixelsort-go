package engine

import "math"

// BrightestSpot finds the brightest blob of a picture, for "freeze the brightest spot" (a sun, a lamp). It takes the top
// 1.5% of pixels by luma (the threshold comes from a 256-bin histogram), then returns the centroid and an ellipse that
// would cover that many pixels, as fractions of the picture: cx, cy, and the full width and height of the ellipse.
// Everything is integer sums until the final divisions, and a flat image still gives a finite ellipse.
func BrightestSpot(im *Image) (cx, cy, w, h float64) {
	n := len(im.Pix)
	if n == 0 || im.W < 1 || im.H < 1 {
		return 0.5, 0.5, 0, 0
	}
	luma := KeyFor(KeyLuma, false)
	var hist [256]int
	for _, p := range im.Pix {
		hist[luma(p)]++
	}
	threshold, acc := 255, 0
	for ; threshold > 0; threshold-- {
		acc += hist[threshold]
		if float64(acc) >= float64(n)*0.015 {
			break
		}
	}
	var sx, sy, count int64
	for i, p := range im.Pix {
		if int(luma(p)) >= threshold {
			sx += int64(i % im.W)
			sy += int64(i / im.W)
			count++
		}
	}
	if count == 0 {
		return 0.5, 0.5, 0, 0
	}
	radius := float64(math.Sqrt(float64(count)/math.Pi)) * 1.15
	cx = float64(sx) / float64(count) / float64(im.W)
	cy = float64(sy) / float64(count) / float64(im.H)
	return cx, cy, 2 * radius / float64(im.W), 2 * radius / float64(im.H)
}
