package engine

// RNG is SplitMix64. It is tiny, fast, passes the usual statistical suites for this use, and, unlike math/rand,
// its output is defined by this file alone, so it never changes under us (decision E5). The engine never uses
// math/rand: a Go release is then free to change the result of a recipe.
type RNG struct{ s uint64 }

func mix64(z uint64) uint64 {
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

// NewRNG returns a generator whose first output is mix64(seed + golden gamma). NewRNG(0) is the reference
// SplitMix64 sequence 0xe220a8397b1dcdaf, 0x6e789e6aa1b965f4, 0x06c45d188009454f, ...
func NewRNG(seed uint64) *RNG { return &RNG{s: seed} }

// NewStream returns an independent generator for (seed, id), for example (recipe seed, line number). One stream
// per line is what makes a recipe's randomness independent of how many lines the image happens to have.
func NewStream(seed, id uint32) *RNG { return &RNG{s: mix64(uint64(seed)<<32 | uint64(id))} }

// Uint64 returns the next 64 random bits.
func (r *RNG) Uint64() uint64 { r.s += 0x9e3779b97f4a7c15; return mix64(r.s) }

// Uint32n returns a number in [0, n) by multiply-shift. The bias is below n/2^32, which is irrelevant here and
// keeps the function branch-free and identical on every platform. n == 0 returns 0.
func (r *RNG) Uint32n(n uint32) uint32 {
	return uint32((uint64(uint32(r.Uint64()>>32)) * uint64(n)) >> 32)
}
