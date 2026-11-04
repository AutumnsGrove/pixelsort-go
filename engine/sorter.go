package engine

// Sort applies the plan and returns a new image. The Plan's own data is untouched, so Sort can be called
// repeatedly and always returns the same result (decision E8).
//
// Each interval is sorted stably by its class's key. Short intervals use insertion sort, which is faster than
// setting up 256 counters; longer ones use a stable counting sort over the 256 keys, which is linear regardless of
// interval length. Non-interval pixels are copied through untouched.
func (pl *Plan) Sort() *Image {
	dst := make([]uint32, len(pl.Orig))
	copy(dst, pl.Orig)

	longest := 0
	for _, iv := range pl.Intervals {
		longest = max(longest, int(iv.B-iv.A))
	}
	order := make([]int32, longest)
	for _, iv := range pl.Intervals {
		pl.sortInterval(dst, order, iv)
	}
	pl.blend(dst)
	return &Image{W: pl.W, H: pl.H, Pix: dst}
}

// sortInterval sorts one interval into dst, using order as scratch space.
func (pl *Plan) sortInterval(dst []uint32, order []int32, iv Interval) {
	line := pl.Lines.P
	n := int(iv.B - iv.A)
	if n < 32 {
		for i := 0; i < n; i++ {
			order[i] = line[int(iv.A)+i]
		}
		for i := 1; i < n; i++ {
			v, kv := order[i], pl.Keys[order[i]]
			j := i - 1
			for j >= 0 && pl.Keys[order[j]] > kv {
				order[j+1] = order[j]
				j--
			}
			order[j+1] = v
		}
		for i := 0; i < n; i++ {
			dst[line[int(iv.A)+i]] = pl.Orig[order[i]]
		}
		return
	}

	var count [256]int
	for i := iv.A; i < iv.B; i++ {
		count[pl.Keys[line[i]]]++
	}
	sum := 0
	for k := range count {
		c := count[k]
		count[k] = sum
		sum += c
	}
	// Walking the interval from the front and placing into each key's next free slot keeps ties in input order.
	for i := iv.A; i < iv.B; i++ {
		pos := line[i]
		k := pl.Keys[pos]
		order[count[k]] = pos
		count[k]++
	}
	for i := 0; i < n; i++ {
		dst[line[int(iv.A)+i]] = pl.Orig[order[i]]
	}
}

// blend applies the soft mask (feather): out = lerp(sorted, original, alpha), so alpha 0 keeps the sort and alpha
// 255 restores the original (decision E11).
func (pl *Plan) blend(dst []uint32) {
	if pl.soft == nil {
		return
	}
	for i := range dst {
		a := uint32(pl.soft[i])
		if a == 0 {
			continue
		}
		if a >= 255 {
			dst[i] = pl.Orig[i]
			continue
		}
		pr, pg, pb, pa := Unpack(dst[i])
		qr, qg, qb, qa := Unpack(pl.Orig[i])
		dst[i] = Pack(
			uint8(Lerp255(uint32(pr), uint32(qr), a)&0xff),
			uint8(Lerp255(uint32(pg), uint32(qg), a)&0xff),
			uint8(Lerp255(uint32(pb), uint32(qb), a)&0xff),
			uint8(Lerp255(uint32(pa), uint32(qa), a)&0xff),
		)
	}
}
