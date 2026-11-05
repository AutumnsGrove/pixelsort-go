package shapes

// VoronoiSitesForTest returns the sites a Voronoi tiling uses, so a test can compare the bucketed search with brute force.
func VoronoiSitesForTest(w, h int, t Tiling) [][2]float64 {
	S := max(6, pixels(w, t.Size))
	g := newSiteGrid(w, h, S, t.Seed)
	out := make([][2]float64, len(g.xs))
	for i := range out {
		out[i] = [2]float64{g.xs[i], g.ys[i]}
	}
	return out
}
