// Package shapes turns vector descriptions of regions (tilings, custom polygons) into label maps the engine sorts
// within. Everything is rasterised here, in Go, from specs: a canvas fill would anti-alias its edges and blend two ids
// into a bogus third (PLAN.md 3.4). Port of tessellate and classify in mockups/shared/regions.js.
//
// Geometry uses floats, with decision E6's rule applied: every product is wrapped in float64(...) so arm64 cannot fuse
// a multiply-add, and only + - * /, Sqrt, Floor, Round and Sincos of whole-degree angles appear. The cross-platform
// golden test decides; if a map ever differs between platforms the shape moves to fixed point.
package shapes

import (
	"errors"
	"fmt"
	"math"
)

// MaxCells is the most cells a tiling may have: labels are uint16 and 0 means "between shapes".
const MaxCells = 65535

// Shape names accepted in Tiling.Shape.
const (
	Square   = "square"
	Hexagon  = "hexagon"
	Triangle = "triangle"
	Diamond  = "diamond"
	Circle   = "circle"
	Octagon  = "octagon"
	Voronoi  = "voronoi"
	Custom   = "custom"
)

// ErrTiling means a tiling spec is invalid or produces too many cells.
var ErrTiling = errors.New("shapes: invalid tiling")

// Tiling is the JSON spec of a tessellation. Size and Gap are per mille of the image width (decision E4); Rotate is
// whole degrees; polygon coordinates are fractions of the tile.
type Tiling struct {
	Shape   string         `json:"shape"`
	Size    int            `json:"size"`   // per mille of width, 10..1000
	Gap     int            `json:"gap"`    // per mille of width, 0..200
	Rotate  int            `json:"rotate"` // degrees 0..359
	Seed    uint32         `json:"seed"`   // voronoi sites, random pattern
	Stagger bool           `json:"stagger,omitempty"`
	Poly    [][2]float64   `json:"poly,omitempty"`
	More    [][][2]float64 `json:"more,omitempty"`
	Pattern string         `json:"pattern"`
	Kinds   int            `json:"kinds,omitempty"`
}

// Cells is a label map: Labels[pixel] is a cell id (0 = between shapes), and CI, CJ give each cell's grid coordinates
// (index 0 is unused). Count is the number of cells; ids are contiguous 1..Count.
type Cells struct {
	Labels []uint16
	CI, CJ []int32
	Count  int
}

var sq3 = math.Sqrt(3)

type cellKey struct{ a, b, c int32 }

// numberer hands out cell ids in first-seen pixel order, which is deterministic. The map is only ever looked up, never
// iterated, so its order cannot reach the output.
type numberer struct {
	ids      map[cellKey]uint16
	ci, cj   []int32
	last     cellKey
	lastID   uint16
	haveLast bool
	overflow bool
}

func newNumberer() *numberer {
	return &numberer{ids: map[cellKey]uint16{}, ci: []int32{0}, cj: []int32{0}}
}

func (n *numberer) id(k cellKey, i, j int32) uint16 {
	if n.haveLast && k == n.last {
		return n.lastID // consecutive pixels almost always share a cell
	}
	id, ok := n.ids[k]
	if !ok {
		if len(n.ci) > MaxCells {
			n.overflow = true
			return 0
		}
		id = uint16(len(n.ci)) //nolint:gosec // bounded by MaxCells above
		n.ids[k] = id
		n.ci, n.cj = append(n.ci, i), append(n.cj, j)
	}
	n.last, n.lastID, n.haveLast = k, id, true
	return id
}

// sincosDeg is Sincos of whole degrees, exact at multiples of 90 so a quarter turn puts pixels exactly on the grid
// instead of a rounding error either side of a cell boundary.
func sincosDeg(deg int) (sin, cos float64) {
	switch ((deg % 360) + 360) % 360 {
	case 0:
		return 0, 1
	case 90:
		return 1, 0
	case 180:
		return 0, -1
	case 270:
		return -1, 0
	}
	return math.Sincos(float64(deg) * math.Pi / 180)
}

func pixels(w, v int) int { return (w*v + 500) / 1000 }

// Tessellate rasterises a tiling over a w x h image.
func Tessellate(w, h int, t Tiling) (Cells, error) {
	if w < 1 || h < 1 || w > 1<<14 || h > 1<<14 {
		return Cells{}, fmt.Errorf("shapes: %dx%d image: %w", w, h, ErrTiling)
	}
	switch t.Shape {
	case Square, Hexagon, Triangle, Diamond, Circle, Octagon, Voronoi, Custom:
	default:
		return Cells{}, fmt.Errorf("shapes: unknown shape %q: %w", t.Shape, ErrTiling)
	}
	if t.Size < 1 || t.Size > 1000 || t.Gap < 0 || t.Gap > 1000 {
		return Cells{}, fmt.Errorf("shapes: size %d or gap %d out of range: %w", t.Size, t.Gap, ErrTiling)
	}
	S := float64(max(6, pixels(w, t.Size)))
	gap := float64(pixels(w, t.Gap))

	var bits []uint8
	var sites *siteGrid
	switch t.Shape {
	case Custom:
		var err error
		if bits, err = polyBits(t.Poly, t.More, bitmapSize); err != nil {
			return Cells{}, err
		}
	case Voronoi:
		sites = newSiteGrid(w, h, int(S), t.Seed)
	}

	deg := ((t.Rotate % 360) + 360) % 360
	sin, cos := sincosDeg(-deg)
	cx0, cy0 := float64(w)/2, float64(h)/2
	off := float64(S * 200) // keeps rotated coordinates positive, so Floor agrees with integer division

	num := newNumberer()
	labels := make([]uint16, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			// Sample at the pixel centre, so a cell and its mirror image cover the same number of pixels (the mockup
			// sampled the corner, which made every shape one pixel lopsided).
			X, Y := float64(x)+0.5-cx0, float64(y)+0.5-cy0
			rx := float64(float64(X*cos)-float64(Y*sin)) + cx0 + off
			ry := float64(float64(X*sin)+float64(Y*cos)) + cy0 + off
			var id uint16
			switch t.Shape {
			case Custom:
				id = customCell(num, bits, t, rx, ry, S, gap)
			case Voronoi:
				id = voronoiCell(num, sites, x, y, gap)
			case Hexagon:
				id = hexCell(num, rx, ry, S, gap)
			case Triangle:
				id = triangleCell(num, rx, ry, S, gap)
			default:
				id = gridCell(num, t.Shape, rx, ry, S, gap)
			}
			labels[y*w+x] = id
		}
	}
	if num.overflow {
		return Cells{}, fmt.Errorf("shapes: more than %d cells; use a larger size: %w", MaxCells, ErrTiling)
	}
	return Cells{Labels: labels, CI: num.ci, CJ: num.cj, Count: len(num.ci) - 1}, nil
}

// gridCell is square, diamond (the grid turned 45 degrees), circle and octagon: a square grid with an inset shape.
func gridCell(num *numberer, shape string, rx, ry, cell, gap float64) uint16 {
	ux, uy := rx, ry
	if shape == Diamond {
		ux = float64(rx+ry) / math.Sqrt2
		uy = float64(ry-rx) / math.Sqrt2
	}
	i, j := math.Floor(ux/cell), math.Floor(uy/cell)
	lx := ux - float64(float64(i+0.5)*cell)
	ly := uy - float64(float64(j+0.5)*cell)
	R := cell/2 - gap/2
	ok := math.Abs(lx) <= R && math.Abs(ly) <= R
	if ok && shape == Circle {
		ok = float64(lx*lx)+float64(ly*ly) <= float64(R*R)
	}
	if ok && shape == Octagon {
		ok = math.Abs(lx)+math.Abs(ly) <= float64(R*1.4142)
	}
	if !ok {
		return 0
	}
	return num.id(cellKey{int32(i), int32(j), 0}, int32(i), int32(j))
}

// hexCell rounds to the nearest hexagon in cube coordinates, then tests the inset hexagon.
func hexCell(num *numberer, rx, ry, cell, gap float64) uint16 {
	Rc := cell / 2
	xf := float64(float64(sq3/3)*rx-ry/3) / Rc
	zf := float64(float64(2.0/3)*ry) / Rc
	yf := -xf - zf
	rxx, ryy, rzz := math.Round(xf), math.Round(yf), math.Round(zf)
	ex, ey, ez := math.Abs(rxx-xf), math.Abs(ryy-yf), math.Abs(rzz-zf)
	// Cube coordinates sum to zero, so the one with the largest rounding error is recomputed from the other two. Only
	// x and z are used below, so when y is the odd one out nothing needs to change.
	switch {
	case ex > ey && ex > ez:
		rxx = -ryy - rzz
	case ey > ez:
		// y is recomputed from x and z, which are already right
	default:
		rzz = -rxx - ryy
	}
	ccx := float64(float64(Rc*sq3) * (rxx + rzz/2))
	ccy := float64(float64(Rc*1.5) * rzz)
	lx, ly := math.Abs(rx-ccx), math.Abs(ry-ccy)
	R := Rc - float64(gap*0.6)
	if lx <= float64(R*sq3/2) && ly+lx/sq3 <= R {
		return num.id(cellKey{int32(rxx), int32(rzz), 0}, int32(rxx), int32(rzz))
	}
	return 0
}

// triangleCell splits each parallelogram of the skewed grid into two triangles and keeps pixels at least gap/2 from
// every edge.
func triangleCell(num *numberer, rx, ry, S, gap float64) uint16 {
	u := (rx - ry/sq3) / S
	v := float64(2*ry/sq3) / S
	i, j := math.Floor(u), math.Floor(v)
	fu, fv := u-i, v-j
	var l1, l2, l3 float64
	half := int32(0)
	if fu+fv < 1 {
		l1, l2, l3 = fu, fv, 1-fu-fv
	} else {
		half = 1
		l1, l2, l3 = 1-fu, 1-fv, fu+fv-1
	}
	if float64(float64(min(l1, l2, l3)*S)*sq3/2) >= gap/2 {
		return num.id(cellKey{int32(i), int32(j), half}, int32(i)*2+half, int32(j))
	}
	return 0
}
