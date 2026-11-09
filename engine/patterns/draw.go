package patterns

// The drawings. Each one fills a w*h plane with 0/1 bytes; the spec, the catalog and the checks live in patterns.go.

import "math"

// truchet draws tiles whose seams join across the grid: quarter arcs, diagonal strands, or a honeycomb.
func truchet(out []uint8, w, h int, variant string, f frame, cell, thick int, seed uint32) {
	s := float64(cell)
	t := float64(thick) / 2
	var verts [6][2]float64
	if variant == "hex" {
		verts = hexVertices(s)
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			u, v := f.at(x, y)
			tx, ty := math.Floor(u/s), math.Floor(v/s)
			ox, oy := float64(tx*s), float64(ty*s)
			fx, fy := float64(u-ox), float64(v-oy)
			k := hash(int32(tx), int32(ty), seed)
			var on bool
			switch variant {
			case "arc":
				c1x, c1y, c2x, c2y := 0.0, 0.0, s, s
				if k&1 != 0 {
					c1x, c1y, c2x, c2y = s, 0, 0, s
				}
				d1 := math.Hypot(float64(fx-c1x), float64(fy-c1y))
				d2 := math.Hypot(float64(fx-c2x), float64(fy-c2y))
				on = math.Abs(float64(d1-s)) <= t || math.Abs(float64(d2-s)) <= t
			case "strand":
				d := math.Abs(float64(fx - fy))
				if k&1 != 0 {
					d = math.Abs(float64(fx + fy - s))
				}
				on = d <= t*math.Sqrt2
			case "hex":
				on = hexAt(u, v, s, t, seed, verts)
			}
			if on {
				out[y*w+x] = 1
			}
		}
	}
}

// hexVertices returns the six corners of a pointy-top hexagon of circumradius size, once per mask.
func hexVertices(size float64) [6][2]float64 {
	var out [6][2]float64
	for k := 0; k < 6; k++ {
		a := float64(k)*math.Pi/3 + math.Pi/6
		out[k] = [2]float64{float64(size * math.Cos(a)), float64(size * math.Sin(a))}
	}
	return out
}

// hexAt draws the edges of the hexagon containing (u,v), with a quarter of the hexes left out so the wireframe opens up.
func hexAt(u, v, size, thick float64, seed uint32, verts [6][2]float64) bool {
	q := (math.Sqrt(3)/3*u - v/3) / size
	r := (2.0 / 3.0 * v) / size
	qi, ri := hexRound(q, r)
	if hash(qi, ri, seed)&3 == 0 {
		return false
	}
	cx := float64(size * math.Sqrt(3) * (float64(qi) + float64(ri)/2))
	cy := float64(size * 1.5 * float64(ri))
	px, py := float64(u-cx), float64(v-cy)
	for k := 0; k < 6; k++ {
		a, b := verts[k], verts[(k+1)%6]
		if segmentDist(px, py, a[0], a[1], b[0], b[1]) <= thick {
			return true
		}
	}
	return false
}

// hexRound rounds fractional axial coordinates to the nearest hex, in cube space (the standard hex-grid rounding).
func hexRound(q, r float64) (int32, int32) {
	s := -q - r
	rq, rr, rs := math.Round(q), math.Round(r), math.Round(s)
	dq, dr, ds := math.Abs(rq-q), math.Abs(rr-r), math.Abs(rs-s)
	switch {
	case dq > dr && dq > ds:
		rq = -rr - rs
	case dr > ds:
		rr = -rq - rs
	}
	return int32(rq), int32(rr)
}

// segmentDist is the distance from a point to a line segment.
func segmentDist(px, py, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	l2 := float64(dx*dx) + float64(dy*dy)
	t := 0.0
	if l2 > 0 {
		t = math.Min(1, math.Max(0, (float64((px-ax)*dx)+float64((py-ay)*dy))/l2))
	}
	qx, qy := float64((px-ax)-t*dx), float64((py-ay)-t*dy)
	return math.Hypot(qx, qy)
}

// interference draws the zero crossings of two crossing waves, which is where the thin bright lines live.
func interference(out []uint8, w, h int, variant string, f frame, cell, thick int, seed uint32) {
	freq := 2 * math.Pi / float64(cell)
	limit := 0.7 * float64(thick) / float64(cell)
	var c1x, c1y, c2x, c2y float64
	if variant == "rings" {
		ang := float64(hash(0, 0, seed)%360) * math.Pi / 180
		d := float64(cell) * 2
		ox, oy := float64(d*math.Cos(ang)), float64(d*math.Sin(ang))
		c1x, c1y, c2x, c2y = f.cx+ox, f.cy+oy, f.cx-ox, f.cy-oy
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			u, v := f.at(x, y)
			var val float64
			if variant == "mesh" {
				val = math.Sin(float64(u*freq)) + math.Sin(float64((u*0.5+v*0.8660254037844386)*freq))
			} else {
				r1 := math.Hypot(float64(u-c1x), float64(v-c1y))
				r2 := math.Hypot(float64(u-c2x), float64(v-c2y))
				val = math.Sin(float64(r1*freq)) + math.Sin(float64(r2*freq))
			}
			if math.Abs(val) <= limit {
				out[y*w+x] = 1
			}
		}
	}
}

// radial draws around the picture's centre: a spiral, straight spokes, or rings broken into arcs.
func radial(out []uint8, w, h int, variant string, f frame, cell, thick, detail int) {
	freq := 2 * math.Pi / float64(cell)
	band := float64(thick) / float64(cell)
	arms := float64(detail)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			u, v := f.at(x, y)
			dx, dy := float64(u-f.cx), float64(v-f.cy)
			r := math.Hypot(dx, dy)
			a := math.Atan2(dy, dx)
			var on bool
			switch variant {
			case "spiral":
				// distance from the phase to the nearest crest of the sine, converted back to pixels
				phase := float64(r*freq - a*arms)
				on = crestDistance(phase) <= freq*float64(thick)/2
			case "spokes":
				// a spoke is a crest of cos(angle*arms); d is the distance to the nearest one, in phase units
				on = crestDistance(float64(a*arms)) <= arms*band/2
			case "broken":
				d := math.Abs(float64(math.Mod(r, float64(cell)) - float64(cell)/2))
				on = d <= float64(thick)/2 && math.Sin(float64(a*arms)) > -0.3
			}
			if on {
				out[y*w+x] = 1
			}
		}
	}
}

// crestDistance is how far phase is from the nearest crest of cos(phase), i.e. the nearest multiple of 2*pi. It is
// used instead of a threshold on sin/cos, which would make the flat top of the wave a wide wedge rather than a line.
func crestDistance(phase float64) float64 {
	m := math.Mod(phase, 2*math.Pi)
	if m < 0 {
		m += 2 * math.Pi
	}
	return math.Min(m, 2*math.Pi-m)
}

// grid draws straight-edged lattices: woven bands, chevrons, or an isometric triangular wireframe.
func grid(out []uint8, w, h int, variant string, f frame, cell, thick int, seed uint32) {
	s := float64(cell)
	t := float64(thick) / 2
	cos60, sin60 := math.Cos(math.Pi/3), math.Sin(math.Pi/3)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			u, v := f.at(x, y)
			var on bool
			switch variant {
			case "woven":
				tx, ty := math.Floor(u/s), math.Floor(v/s)
				fx, fy := float64(u-tx*s), float64(v-ty*s)
				k := hash(int32(tx), int32(ty), seed)
				if (int32(tx)+int32(ty)+int32(k&1))&1 == 0 {
					on = math.Abs(float64(fx-s/2)) <= t
				} else {
					on = math.Abs(float64(fy-s/2)) <= t
				}
			case "chevron":
				yy := math.Abs(float64(v - f.cy))
				on = math.Abs(float64(math.Mod(u+yy, s)-s/2)) <= t
			case "iso":
				d1 := math.Abs(float64(math.Mod(v, s) - s/2))
				d2 := math.Abs(float64(math.Mod(u*cos60+v*sin60, s) - s/2))
				d3 := math.Abs(float64(math.Mod(-u*cos60+v*sin60, s) - s/2))
				on = d1 <= t || d2 <= t || d3 <= t
			}
			if on {
				out[y*w+x] = 1
			}
		}
	}
}
