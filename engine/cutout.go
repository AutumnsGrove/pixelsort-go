package engine

import (
	"errors"
	"fmt"
	"math"
)

// "Cut out this object": grow a region from a point in the picture, fill its small holes, trace its outer edge and simplify
// the outline. It is plain deterministic pixel work, so the Shape helper can offer it with no model at all, and the model's
// tools call the same code. Nothing here reads anything but the picture.

// CutoutMaxPoints is the most points an outline keeps; simplification stops there.
const CutoutMaxPoints = 200

const (
	// CutoutMinArea is the fewest pixels a region may have to count as a shape.
	CutoutMinArea = 40
	// cutoutHoleMaxPct is the biggest hole (as a share of the picture, in hundredths of a percent) that is filled: specks are not
	// part of the shape's outline, a ring's real opening is.
	cutoutHoleMaxPer10k = 30
	// cutoutReach is how far a pixel's colour may be from the seed's, per point of tolerance (RGB distance, tenths).
	cutoutReachTenths = 22
)

var (
	// ErrCutoutTooBig means the region spread over more of the picture than allowed (a click on the sky or the background).
	ErrCutoutTooBig = errors.New("engine: that region spreads over too much of the picture")
	// ErrCutoutTooSmall means the region is too small, or too thin (a line), to make a shape from.
	ErrCutoutTooSmall = errors.New("engine: that region is too small or too thin to be a shape")
)

// Point is a pixel position.
type Point struct{ X, Y int }

// Cutout is a region grown from a point, with its outline.
type Cutout struct {
	// Outline is the outer edge, simplified, as pixel positions in order (a closed ring: the last joins the first).
	Outline []Point
	// PointsBefore is how many points the edge had before it was simplified.
	PointsBefore int
	// BBox is x, y, width, height of the region.
	BBox [4]int
	// Area is the number of pixels in Mask.
	Area int
	// Mean is the average colour of the region.
	Mean [3]uint8
	// Mask is 1 for the region (small holes filled) and 0 elsewhere, W*H, so a page can draw it over the picture.
	Mask []uint8
}

func clampInt(v, lo, hi int) int { return min(hi, max(lo, v)) }

// avg8 is sum/count for channel values, so the result is always 0..255.
func avg8(sum, count int) uint8 { return uint8(sum / count) } //nolint:gosec // G115: a mean of values 0..255 is 0..255

// CutOut grows a region from (x, y): every pixel connected to the seed whose colour is within `tolerance` (1..100) of the
// seed's. The click is clamped into the picture. maxAreaPct (1..95) is the biggest share of the picture the region may cover.
func CutOut(im *Image, x, y, tolerance, maxAreaPct int) (Cutout, error) {
	w, h := im.W, im.H
	x, y = clampInt(x, 0, w-1), clampInt(y, 0, h-1)
	reach := clampInt(tolerance, 1, 100) * cutoutReachTenths / 10
	reach2 := int64(reach) * int64(reach)
	limit := int(int64(w) * int64(h) * int64(clampInt(maxAreaPct, 1, 95)) / 100)

	sr, sg, sb, _ := Unpack(im.Pix[y*w+x])
	mask := make([]uint8, w*h)
	queue := make([]int32, 0, 1024)
	queue = append(queue, pos32(y*w+x))
	mask[y*w+x] = 1
	var area, sumR, sumG, sumB int
	for head := 0; head < len(queue); head++ {
		p := int(queue[head])
		area++
		r, g, b, _ := Unpack(im.Pix[p])
		sumR, sumG, sumB = sumR+int(r), sumG+int(g), sumB+int(b)
		if area > limit {
			return Cutout{}, ErrCutoutTooBig
		}
		px, py := p%w, p/w
		for _, n := range [4]struct {
			ok bool
			at int
		}{{px > 0, p - 1}, {px < w-1, p + 1}, {py > 0, p - w}, {py < h-1, p + w}} {
			if !n.ok || mask[n.at] != 0 {
				continue
			}
			nr, ng, nb, _ := Unpack(im.Pix[n.at])
			dr, dg, db := int64(nr)-int64(sr), int64(ng)-int64(sg), int64(nb)-int64(sb)
			if dr*dr+dg*dg+db*db <= reach2 {
				mask[n.at] = 1
				queue = append(queue, pos32(n.at))
			}
		}
	}
	if area < CutoutMinArea {
		return Cutout{}, ErrCutoutTooSmall
	}
	mean := [3]uint8{avg8(sumR, area), avg8(sumG, area), avg8(sumB, area)}

	fillSmallHoles(mask, w, h)
	area = 0
	x0, y0, x1, y1 := w, h, -1, -1
	for i, v := range mask {
		if v == 0 {
			continue
		}
		area++
		px, py := i%w, i/w
		x0, y0, x1, y1 = min(x0, px), min(y0, py), max(x1, px), max(y1, py)
	}
	ring := traceOuter(mask, w, h)
	outline := simplifyRing(ring, 1.4, CutoutMaxPoints)
	if len(outline) < 3 { // a line one pixel wide traces out and back and has no inside
		return Cutout{}, ErrCutoutTooSmall
	}
	return Cutout{
		Outline: outline, PointsBefore: len(ring),
		BBox: [4]int{x0, y0, x1 - x0 + 1, y1 - y0 + 1}, Area: area, Mean: mean, Mask: mask,
	}, nil
}

// fillSmallHoles turns on the background pixels that cannot reach the picture's border and make up a hole no bigger than a
// small share of the picture.
func fillSmallHoles(mask []uint8, w, h int) {
	seen := make([]uint8, len(mask))
	queue := make([]int32, 0, 1024)
	push := func(p int) {
		if mask[p] == 0 && seen[p] == 0 {
			seen[p] = 1
			queue = append(queue, pos32(p))
		}
	}
	for x := 0; x < w; x++ {
		push(x)
		push((h-1)*w + x)
	}
	for y := 0; y < h; y++ {
		push(y * w)
		push(y*w + w - 1)
	}
	for head := 0; head < len(queue); head++ {
		p := int(queue[head])
		px, py := p%w, p/w
		if px > 0 {
			push(p - 1)
		}
		if px < w-1 {
			push(p + 1)
		}
		if py > 0 {
			push(p - w)
		}
		if py < h-1 {
			push(p + w)
		}
	}
	maxHole := int(int64(w) * int64(h) * cutoutHoleMaxPer10k / 10000)
	visited := make([]uint8, len(mask))
	var comp []int32
	for i := range mask {
		if mask[i] != 0 || seen[i] != 0 || visited[i] != 0 {
			continue
		}
		comp = append(comp[:0], int32(i))
		visited[i] = 1
		for head := 0; head < len(comp); head++ {
			p := int(comp[head])
			px, py := p%w, p/w
			for _, n := range [4]struct {
				ok bool
				at int
			}{{px > 0, p - 1}, {px < w-1, p + 1}, {py > 0, p - w}, {py < h-1, p + w}} {
				if n.ok && mask[n.at] == 0 && seen[n.at] == 0 && visited[n.at] == 0 {
					visited[n.at] = 1
					comp = append(comp, pos32(n.at))
				}
			}
		}
		if len(comp) <= maxHole {
			for _, p := range comp {
				mask[p] = 1
			}
		}
	}
}

// traceOuter follows the outer boundary of the first region found in reading order (Moore-neighbour tracing, clockwise on
// screen) and returns its boundary pixels in order.
func traceOuter(mask []uint8, w, h int) []Point {
	start := -1
	for i, v := range mask {
		if v != 0 {
			start = i
			break
		}
	}
	if start < 0 {
		return nil
	}
	dirs := [8][2]int{{1, 0}, {1, 1}, {0, 1}, {-1, 1}, {-1, 0}, {-1, -1}, {0, -1}, {1, -1}}
	on := func(x, y int) bool { return x >= 0 && y >= 0 && x < w && y < h && mask[y*w+x] != 0 }
	sx, sy := start%w, start/w
	x, y, back := sx, sy, 4 // the first pixel in reading order has background to its west
	var ring []Point
	for guard := 4 * len(mask); guard > 0; guard-- {
		ring = append(ring, Point{x, y})
		moved := false
		for i := 0; i < 8; i++ {
			d := (back + 1 + i) % 8
			nx, ny := x+dirs[d][0], y+dirs[d][1]
			if !on(nx, ny) {
				continue
			}
			// the new backtrack is the direction from the new pixel to the last background cell looked at
			prev := (back + i) % 8
			bx, by := x+dirs[prev][0]-nx, y+dirs[prev][1]-ny
			for k, dd := range dirs {
				if dd[0] == bx && dd[1] == by {
					back = k
					break
				}
			}
			x, y, moved = nx, ny, true
			break
		}
		if !moved || (x == sx && y == sy) {
			break
		}
	}
	return ring
}

// simplifyRing reduces a closed ring with Douglas-Peucker, splitting it at its middle so the seam is not special, and
// loosens the tolerance until at most maxPoints remain. It only ever drops points, never moves them.
func simplifyRing(ring []Point, eps float64, maxPoints int) []Point {
	if len(ring) < 8 {
		return append([]Point(nil), ring...)
	}
	half := len(ring) / 2
	var out []Point
	for e := eps; e < 60; e *= 1.4 {
		a := douglasPeucker(ring[:half+1], e)
		second := append(append([]Point(nil), ring[half:]...), ring[0])
		b := douglasPeucker(second, e)
		out = append(append([]Point(nil), a...), b[1:len(b)-1]...)
		if len(out) <= maxPoints {
			break
		}
	}
	if len(out) > maxPoints { // a pathological edge: keep an even sample rather than exceed the cap
		step := float64(len(out)) / float64(maxPoints)
		kept := make([]Point, 0, maxPoints)
		for i := 0; i < maxPoints; i++ {
			kept = append(kept, out[int(float64(i)*step)])
		}
		out = kept
	}
	return out
}

func douglasPeucker(pts []Point, eps float64) []Point {
	if len(pts) < 4 {
		return append([]Point(nil), pts...)
	}
	keep := make([]bool, len(pts))
	keep[0], keep[len(pts)-1] = true, true
	stack := [][2]int{{0, len(pts) - 1}}
	for len(stack) > 0 {
		s := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		a, c := pts[s[0]], pts[s[1]]
		dx, dy := float64(c.X-a.X), float64(c.Y-a.Y)
		length := math.Hypot(dx, dy)
		if length == 0 {
			length = 1
		}
		best, bi := -1.0, -1
		for i := s[0] + 1; i < s[1]; i++ {
			d := math.Abs(dy*float64(pts[i].X)-dx*float64(pts[i].Y)+float64(c.X*a.Y-c.Y*a.X)) / length
			if d > best {
				best, bi = d, i
			}
		}
		if best > eps && bi > 0 {
			keep[bi] = true
			stack = append(stack, [2]int{s[0], bi}, [2]int{bi, s[1]})
		}
	}
	var out []Point
	for i, k := range keep {
		if k {
			out = append(out, pts[i])
		}
	}
	return out
}

// String names a Cutout for test failures.
func (c Cutout) String() string {
	return fmt.Sprintf("cutout{area %d, bbox %v, %d points (from %d)}", c.Area, c.BBox, len(c.Outline), c.PointsBefore)
}
