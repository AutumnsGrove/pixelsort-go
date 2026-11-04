package engine

// EdgeMap returns |8*c - sum(8 neighbours)| for each pixel, clamped to 255, from a luma plane. Neighbours outside
// the image are replaced by the nearest edge pixel (replication). This is the 3x3 Laplacian the `edges` interval
// mode cuts on (decision E7, PLAN.md 3.3): the same kernel as PIL's FIND_EDGES, done in integers so it agrees on
// every platform.
func EdgeMap(luma []uint8, w, h int) []uint8 {
	out := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			centre := int(luma[y*w+x])
			sum := 0
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					if dx == 0 && dy == 0 {
						continue
					}
					ny := min(h-1, max(0, y+dy))
					nx := min(w-1, max(0, x+dx))
					sum += int(luma[ny*w+nx])
				}
			}
			v := 8*centre - sum
			if v < 0 {
				v = -v
			}
			out[y*w+x] = uint8(min(v, 255) & 0xff)
		}
	}
	return out
}
