package engine

import (
	"fmt"
	"math"
	"sort"
)

// What a model (or anyone) needs to talk about a picture without seeing every pixel: its dominant colours, and a short list of
// the distinct areas in it, each with a spot that is inside it. Plain deterministic pixel work over the same region growing
// "Cut out this object" uses, so a listed object can be cut out from its seed and give that object.

// Object is one distinct area of a picture.
type Object struct {
	// ID is "r1", "r2", ... in order of size, biggest first: a name a model can refer to.
	ID string
	// Name says what it looks like and where: "red · top left".
	Name string
	// SeedX, SeedY is a point inside the area, as fractions of the picture, to cut out from.
	SeedX, SeedY float64
	// CX, CY is the middle of the area, as fractions.
	CX, CY float64
	// BBox is x, y, width, height as fractions of the picture.
	BBox [4]float64
	// AreaPct is the share of the picture the area covers.
	AreaPct float64
	// Colour is the average colour as "#rrggbb".
	Colour string
}

const (
	objectsGridX, objectsGridY = 10, 6
	objectsTolerance           = 28
	objectsMaxAreaPct          = 70
)

// ListObjects finds the distinct areas of the picture: it seeds a region on a coarse grid, skips seeds already taken, and keeps
// regions of at least minAreaPct that did not spread over most of the picture (a background is not an object). Biggest first,
// at most maxObjects of them.
func ListObjects(im *Image, minAreaPct float64, maxObjects int) []Object {
	if maxObjects <= 0 {
		return nil
	}
	w, h := im.W, im.H
	limit := int(int64(w) * int64(h) * objectsMaxAreaPct / 100)
	reach := objectsTolerance * cutoutReachTenths / 10
	claimed := make([]uint8, w*h)
	type found struct {
		g      grown
		sx, sy int
	}
	var all []found
	for j := 0; j < objectsGridY; j++ {
		for i := 0; i < objectsGridX; i++ {
			x, y := (2*i+1)*w/(2*objectsGridX), (2*j+1)*h/(2*objectsGridY)
			x, y = clampInt(x, 0, w-1), clampInt(y, 0, h-1)
			if claimed[y*w+x] != 0 {
				continue
			}
			g := growRegion(im, x, y, reach, limit, nil)
			for p, v := range g.mask {
				if v != 0 {
					claimed[p] = 1
				}
			}
			if !g.leaked && float64(g.area)*100/float64(w*h) >= minAreaPct {
				all = append(all, found{g, x, y})
			}
		}
	}
	sort.SliceStable(all, func(a, b int) bool { return all[a].g.area > all[b].g.area })
	if len(all) > maxObjects {
		all = all[:maxObjects]
	}
	out := make([]Object, len(all))
	for n, f := range all {
		g := f.g
		x0, y0, x1, y1 := w, h, -1, -1
		for p, v := range g.mask {
			if v != 0 {
				px, py := p%w, p/w
				x0, y0, x1, y1 = min(x0, px), min(y0, py), max(x1, px), max(y1, py)
			}
		}
		mean := [3]uint8{avg8(g.sum[0], g.area), avg8(g.sum[1], g.area), avg8(g.sum[2], g.area)}
		cx, cy := float64(g.sx)/float64(g.area)/float64(w), float64(g.sy)/float64(g.area)/float64(h)
		out[n] = Object{
			ID: fmt.Sprintf("r%d", n+1), Name: ColourName(mean) + " · " + placeName(cx, cy),
			SeedX: (float64(f.sx) + 0.5) / float64(w), SeedY: (float64(f.sy) + 0.5) / float64(h), CX: round3(cx), CY: round3(cy),
			BBox:    [4]float64{round3(float64(x0) / float64(w)), round3(float64(y0) / float64(h)), round3(float64(x1-x0+1) / float64(w)), round3(float64(y1-y0+1) / float64(h))},
			AreaPct: math.Round(float64(g.area)*1000/float64(w*h)) / 10, Colour: hexColour(mean),
		}
	}
	return out
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

func hexColour(c [3]uint8) string { return fmt.Sprintf("#%02x%02x%02x", c[0], c[1], c[2]) }

func placeName(cx, cy float64) string {
	xs := "middle"
	if cx < 1.0/3 {
		xs = "left"
	} else if cx > 2.0/3 {
		xs = "right"
	}
	switch {
	case cy < 1.0/3:
		return "top " + xs
	case cy > 2.0/3:
		return "bottom " + xs
	}
	return xs
}

// ColourName is a plain-word colour for an average colour: "red", "dark blue", "pale grey".
func ColourName(c [3]uint8) string {
	r, g, b := float64(c[0])/255, float64(c[1])/255, float64(c[2])/255
	mx, mn := math.Max(r, math.Max(g, b)), math.Min(r, math.Min(g, b))
	l, d := (mx+mn)/2, mx-mn
	if l < 0.1 {
		return "dark grey"
	}
	if l > 0.92 {
		return "pale grey"
	}
	var hue float64
	if d > 0.001 {
		switch mx {
		case r:
			hue = math.Mod((g-b)/d+6, 6)
		case g:
			hue = (b-r)/d + 2
		default:
			hue = (r-g)/d + 4
		}
		hue *= 60
	}
	s := 0.0
	if d != 0 {
		s = d / (1 - math.Abs(2*l-1))
	}
	base := "grey"
	if s >= 0.14 {
		switch {
		case hue < 15 || hue >= 345:
			base = "red"
		case hue < 40:
			base = "orange"
		case hue < 70:
			base = "yellow"
		case hue < 160:
			base = "green"
		case hue < 200:
			base = "teal"
		case hue < 255:
			base = "blue"
		case hue < 300:
			base = "purple"
		default:
			base = "pink"
		}
	}
	switch {
	case l < 0.2:
		return "dark " + base
	case l > 0.78:
		return "pale " + base
	}
	return base
}

// Description is the short summary a model gets of a picture before it asks for more.
type Description struct {
	W, H int
	// Palette is up to six dominant colours as "#rrggbb", most common first.
	Palette []string
	// EdgeDensity is the share of neighbouring pixels that differ a lot in brightness: how busy the picture is.
	EdgeDensity float64
	// BrightestX, BrightestY is where the brightest pixel is, as fractions.
	BrightestX, BrightestY float64
}

// Describe summarises a picture: dominant colours, how busy it is, and where it is brightest.
func Describe(im *Image) Description {
	type bucket struct{ n, r, g, b int }
	buckets := map[int]*bucket{}
	edges, bestLuma, best := 0, -1.0, 0
	for i, p := range im.Pix {
		r, g, b, _ := Unpack(p)
		if i%3 == 0 {
			k := int(r>>5)<<6 | int(g>>5)<<3 | int(b>>5)
			bk := buckets[k]
			if bk == nil {
				bk = &bucket{}
				buckets[k] = bk
			}
			bk.n++
			bk.r, bk.g, bk.b = bk.r+int(r), bk.g+int(g), bk.b+int(b)
		}
		l := 0.299*float64(r) + 0.587*float64(g) + 0.114*float64(b)
		if l > bestLuma {
			bestLuma, best = l, i
		}
		if i+1 < len(im.Pix) {
			r2, g2, b2, _ := Unpack(im.Pix[i+1])
			if math.Abs(l-(0.299*float64(r2)+0.587*float64(g2)+0.114*float64(b2))) > 24 {
				edges++
			}
		}
	}
	keys := make([]int, 0, len(buckets))
	for k := range buckets {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(a, b int) bool {
		if buckets[keys[a]].n != buckets[keys[b]].n {
			return buckets[keys[a]].n > buckets[keys[b]].n
		}
		return keys[a] < keys[b]
	})
	d := Description{W: im.W, H: im.H, EdgeDensity: round3(float64(edges) / float64(len(im.Pix)))}
	for _, k := range keys[:min(6, len(keys))] {
		bk := buckets[k]
		d.Palette = append(d.Palette, hexColour([3]uint8{avg8(bk.r, bk.n), avg8(bk.g, bk.n), avg8(bk.b, bk.n)}))
	}
	d.BrightestX, d.BrightestY = round3(float64(best%im.W)/float64(im.W)), round3(float64(best/im.W)/float64(im.H))
	return d
}
