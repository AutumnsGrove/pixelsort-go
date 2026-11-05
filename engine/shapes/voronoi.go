package shapes

import (
	"math"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// siteGrid holds the Voronoi sites bucketed into a grid of square cells, so finding the nearest two sites of a pixel
// looks at a handful of buckets instead of every site: 8 MP would otherwise cost w*h*n operations.
type siteGrid struct {
	xs, ys     []float64
	bucket     int
	bw, bh     int
	start, idx []int32 // bucket b holds idx[start[b]:start[b+1]]
}

// newSiteGrid places n = max(6, w*h/(S*S*1.1)) sites with the integer RNG: each coordinate is one Uint32n divided by a
// constant, so only integer output feeds a single division (platform-independent).
func newSiteGrid(w, h, cell int, seed uint32) *siteGrid {
	n := max(6, (w*h*10)/(cell*cell*11))
	rng := engine.NewStream(seed, 0x564F)
	g := &siteGrid{xs: make([]float64, n), ys: make([]float64, n), bucket: max(1, cell)}
	for i := 0; i < n; i++ {
		g.xs[i] = float64(rng.Uint32n(uint32(w)*256)) / 256 //nolint:gosec // w is at most 2^14, so w*256 fits
		g.ys[i] = float64(rng.Uint32n(uint32(h)*256)) / 256 //nolint:gosec // same bound for h
	}
	g.bw, g.bh = (w+g.bucket-1)/g.bucket, (h+g.bucket-1)/g.bucket
	counts := make([]int32, g.bw*g.bh+1)
	bucketOf := make([]int, n)
	for i := range bucketOf {
		bucketOf[i] = g.bucketAt(g.xs[i], g.ys[i])
		counts[bucketOf[i]+1]++
	}
	for b := 1; b < len(counts); b++ {
		counts[b] += counts[b-1]
	}
	g.start = counts
	g.idx = make([]int32, n)
	fill := append([]int32(nil), counts[:len(counts)-1]...)
	for i := 0; i < n; i++ { // ascending site order keeps tie-breaking identical to a brute-force scan
		g.idx[fill[bucketOf[i]]] = int32(i) //nolint:gosec // n is small
		fill[bucketOf[i]]++
	}
	return g
}

func (g *siteGrid) bucketAt(x, y float64) int {
	bx := min(g.bw-1, max(0, int(x)/g.bucket))
	by := min(g.bh-1, max(0, int(y)/g.bucket))
	return by*g.bw + bx
}

// nearest returns the nearest site and the distances to the nearest and second nearest.
func (g *siteGrid) nearest(x, y int) (best int, d1, d2 float64) {
	fx, fy := float64(x), float64(y)
	bx, by := min(g.bw-1, x/g.bucket), min(g.bh-1, y/g.bucket)
	d1sq, d2sq := math.Inf(1), math.Inf(1)
	best = -1
	maxR := max(g.bw, g.bh)
	for r := 0; r <= maxR; r++ {
		for yy := by - r; yy <= by+r; yy++ {
			for xx := bx - r; xx <= bx+r; xx++ {
				if yy < 0 || yy >= g.bh || xx < 0 || xx >= g.bw {
					continue
				}
				if max(abs(xx-bx), abs(yy-by)) != r { // only the new ring
					continue
				}
				b := yy*g.bw + xx
				for _, s := range g.idx[g.start[b]:g.start[b+1]] {
					dx, dy := fx-g.xs[s], fy-g.ys[s]
					dd := float64(dx*dx) + float64(dy*dy)
					switch {
					case dd < d1sq || (dd == d1sq && int(s) < best):
						d2sq, d1sq, best = d1sq, dd, int(s)
					case dd < d2sq:
						d2sq = dd
					}
				}
			}
		}
		// Everything not yet seen is at least r*bucket away, so once two sites are closer than that we are done.
		if !math.IsInf(d2sq, 1) && math.Sqrt(d2sq) <= float64(r*g.bucket) {
			break
		}
	}
	return best, math.Sqrt(d1sq), math.Sqrt(d2sq)
}

func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

func voronoiCell(num *numberer, g *siteGrid, x, y int, gap float64) uint16 {
	best, d1, d2 := g.nearest(x, y)
	if d2-d1 >= gap {
		return num.id(cellKey{int32(best), 0, 0}, int32(best), 0) //nolint:gosec // best < n, a small number
	}
	return 0
}
