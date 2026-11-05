package engine

import (
	"math/bits"
	"slices"
)

// merge is bottom-up merge sort: pass k merges neighbouring runs of 2^(k-1) into runs of 2^k, taking from the left
// run on ties so equal keys keep their order. It needs ceil(log2 n) passes, and looks like growing blocks.
type merge struct {
	pl     *Plan
	idx    []int
	width  []int // current run width per interval in idx
	tmpPx  []uint32
	tmpKey []uint8
	needed int // passes the longest interval needs
	passes int
}

func newMerge(pl *Plan, idx []int) *merge {
	longest := maxLen(pl, idx)
	f := &merge{pl: pl, idx: idx, width: make([]int, len(idx)), tmpPx: make([]uint32, longest), tmpKey: make([]uint8, longest)}
	for k := range f.width {
		f.width[k] = 1
	}
	if longest > 1 {
		f.needed = bits.Len(uint(longest - 1)) // ceil(log2 longest)
	}
	return f
}

func (f *merge) step(s *Stepper) {
	line := f.pl.Lines.P
	for k, i := range f.idx {
		iv := f.pl.Intervals[i]
		a0, a1 := int(iv.A), int(iv.B)
		w := f.width[k]
		if w >= a1-a0 {
			continue
		}
		for start := a0; start < a1; start += 2 * w {
			mid := min(start+w, a1)
			end := min(start+2*w, a1)
			if mid >= end {
				continue
			}
			f.mergeRuns(s, line, start, mid, end)
		}
		f.width[k] = w * 2
	}
	f.passes++
}

// mergeRuns merges line[start:mid] with line[mid:end] by gathering both into scratch and writing back in order.
func (f *merge) mergeRuns(s *Stepper, line []int32, start, mid, end int) {
	n := end - start
	for t := 0; t < n; t++ {
		pos := line[start+t]
		f.tmpPx[t], f.tmpKey[t] = s.live[pos], s.keys[pos]
	}
	l, r, left := 0, mid-start, mid-start
	for t := 0; t < n; t++ {
		takeLeft := r >= n || (l < left && f.tmpKey[l] <= f.tmpKey[r])
		src := r
		if takeLeft {
			src = l
			l++
		} else {
			r++
		}
		pos := line[start+t]
		s.live[pos], s.keys[pos] = f.tmpPx[src], f.tmpKey[src]
	}
}

func (f *merge) done() bool {
	for k, i := range f.idx {
		if f.width[k] < int(f.pl.Intervals[i].B-f.pl.Intervals[i].A) {
			return false
		}
	}
	return true
}
func (f *merge) weight() int { return len(f.idx) }

// clone copies the run widths; the temporary merge buffers are scratch, so the copy gets its own.
func (f *merge) clone() family {
	c := *f
	c.width = slices.Clone(f.width)
	c.tmpPx = make([]uint32, len(f.tmpPx))
	c.tmpKey = make([]uint8, len(f.tmpKey))
	return &c
}
func (f *merge) progress() float64 {
	return min(0.99, float64(f.passes)/float64(max(1, f.needed)))
}
