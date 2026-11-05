package shapes

import (
	"fmt"
	"math"
)

const (
	bitmapSize = 72 // the outline is rasterised once into 72x72 cells over the unit square
	maxPoints  = 2000
)

// polyBits rasterises an outline plus extra rings into an m x m bitmap with the even-odd rule (ray casting at cell
// centres, rings XOR-ed): a ring nested inside the outline is a hole, one outside is another piece of the same shape.
func polyBits(poly [][2]float64, more [][][2]float64, m int) ([]uint8, error) {
	rings := append([][][2]float64{poly}, more...)
	total := 0
	for _, r := range rings {
		if len(r) < 3 {
			return nil, fmt.Errorf("shapes: a ring needs at least 3 points, got %d: %w", len(r), ErrTiling)
		}
		total += len(r)
		for _, p := range r {
			for _, v := range p {
				if math.IsNaN(v) || math.IsInf(v, 0) || v < -0.5 || v > 1.5 {
					return nil, fmt.Errorf("shapes: polygon coordinate %v outside -0.5..1.5: %w", v, ErrTiling)
				}
			}
		}
	}
	if total > maxPoints {
		return nil, fmt.Errorf("shapes: %d polygon points, at most %d: %w", total, maxPoints, ErrTiling)
	}
	bits := make([]uint8, m*m)
	for y := 0; y < m; y++ {
		for x := 0; x < m; x++ {
			px, py := (float64(x)+0.5)/float64(m), (float64(y)+0.5)/float64(m)
			inside := false
			for _, pl := range rings {
				n := len(pl)
				for a, b := 0, n-1; a < n; b, a = a, a+1 {
					xa, ya, xb, yb := pl[a][0], pl[a][1], pl[b][0], pl[b][1]
					if (ya > py) != (yb > py) && px < float64(float64(xb-xa)*(py-ya))/(yb-ya)+xa {
						inside = !inside
					}
				}
			}
			if inside {
				bits[y*m+x] = 1
			}
		}
	}
	return bits, nil
}

// PolyBitmap rasterises an outline plus extra rings into an m x m even-odd bitmap over the unit square. The mask
// package uses it for polygon objects.
func PolyBitmap(poly [][2]float64, more [][][2]float64, m int) ([]uint8, error) {
	return polyBits(poly, more, m)
}

// customCell tiles the bitmap on the grid: each tile is scaled about its centre to leave the gap, odd rows may be
// shifted half a tile (stagger), and a pixel belongs to its tile's cell when the bitmap is set at its position.
func customCell(num *numberer, bits []uint8, t Tiling, rx, ry, S, gap float64) uint16 {
	rj := math.Floor(ry / S)
	sx := 0.0
	if t.Stagger && int64(rj)&1 == 1 {
		sx = S / 2
	}
	ux := rx + sx
	i := math.Floor(ux / S)
	u0, v0 := ux/S-i, ry/S-rj
	sc := math.Max(0.06, (S-gap)/S)
	uu := (u0-0.5)/sc + 0.5
	vv := (v0-0.5)/sc + 0.5
	if uu < 0 || uu >= 1 || vv < 0 || vv >= 1 {
		return 0
	}
	if bits[int(math.Floor(vv*bitmapSize))*bitmapSize+int(math.Floor(uu*bitmapSize))] == 0 {
		return 0
	}
	return num.id(cellKey{int32(i), int32(rj), 0}, int32(i), int32(rj))
}
