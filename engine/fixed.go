package engine

// Sin1000 is a parabolic sine in integers: phase is a full turn in 0..65535 (wrapping), the result is in
// -1000..1000. It is not an exact sine (maximum error about 5.6%), which is fine for "organic" wave intervals,
// and it is identical on every platform, which math.Sin is not guaranteed to be (decision E6).
func Sin1000(phase uint32) int32 {
	p := phase & 0xFFFF
	// int32 is enough: 4 * 16384 * 16384 is 2^30, and 32768 * 125 is 4_096_000.
	t := int32(p & 0x7FFF)
	y := 4 * t * (32768 - t) / 32768 // 0..32768 over one half turn
	v := y * 125 / 4096              // y*1000/32768, scaled down so it cannot overflow
	if p >= 0x8000 {
		return -v
	}
	return v
}

// Lerp255 blends two 8-bit channel values with weight a/255 on q, rounding to nearest, integers only.
func Lerp255(p, q, a uint32) uint32 { return (p*(255-a) + q*a + 127) / 255 }
