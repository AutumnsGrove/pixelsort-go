package shapes

// hash matches hash() in mockups/shared/regions.js, whose JS integer operations wrap at 32 bits.
func hash(n uint32) uint32 {
	n = (n ^ 61) ^ (n >> 16)
	n += n << 3
	n ^= n >> 4
	n *= 0x27d4eb2d
	n ^= n >> 15
	return n
}

// Pattern names accepted by Classify.
const (
	PatternAll     = "all"
	PatternChecker = "checker"
	PatternThirds  = "thirds"
	PatternRandom  = "random"
)

// Classify assigns a class to every cell by a pattern and returns classOf indexed by cell id. Cell 0 (between shapes)
// is class 0; real cells are classes 1 and up. An unknown pattern behaves like "all".
func Classify(c Cells, pattern string, kinds int, seed uint32) []uint8 {
	out := make([]uint8, c.Count+1)
	for id := 1; id <= c.Count; id++ {
		i, j := c.CI[id], c.CJ[id]
		class := 1
		switch pattern {
		case PatternChecker:
			class = 1 + int(((i+j)%2+2)%2)
		case PatternThirds:
			class = 1 + int(((i+j)%3+3)%3)
		case PatternRandom:
			k := max(1, kinds)
			if kinds == 0 {
				k = 3
			}
			class = 1 + int(hash(uint32(id)*2654435761+seed)%uint32(k)) //nolint:gosec // id <= 65535; the wrap is the point
		}
		out[id] = uint8(min(class, 255)) //nolint:gosec // clamped to a byte
	}
	return out
}
