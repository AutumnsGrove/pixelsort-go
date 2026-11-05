package engine

import "slices"

// insertion is insertion sort, one element per pass: the next pixel slides left past every strictly greater key,
// which is the classic streaking look.
type insertion struct {
	pl     *Plan
	idx    []int
	cur    []int // next position (index into Lines.P) to insert, per interval in idx
	maxLen int
	passes int
}

func newInsertion(pl *Plan, idx []int) *insertion {
	f := &insertion{pl: pl, idx: idx, cur: make([]int, len(idx)), maxLen: maxLen(pl, idx)}
	for k, i := range idx {
		f.cur[k] = int(pl.Intervals[i].A) + 1
	}
	return f
}

func (f *insertion) step(s *Stepper) {
	line := f.pl.Lines.P
	for k, i := range f.idx {
		iv := f.pl.Intervals[i]
		a0, a1 := int(iv.A), int(iv.B)
		cur := f.cur[k]
		if cur >= a1 {
			continue
		}
		pos := line[cur]
		px, key := s.live[pos], s.keys[pos]
		j := cur - 1
		for j >= a0 && s.keys[line[j]] > key {
			s.live[line[j+1]], s.keys[line[j+1]] = s.live[line[j]], s.keys[line[j]]
			j--
		}
		s.live[line[j+1]], s.keys[line[j+1]] = px, key
		f.cur[k] = cur + 1
	}
	f.passes++
}

func (f *insertion) done() bool {
	for k, i := range f.idx {
		if f.cur[k] < int(f.pl.Intervals[i].B) {
			return false
		}
	}
	return true
}
func (f *insertion) weight() int { return len(f.idx) }

// clone copies the per-interval cursors (the interval list is read-only and shared).
func (f *insertion) clone() family {
	c := *f
	c.cur = slices.Clone(f.cur)
	return &c
}
func (f *insertion) progress() float64 {
	return min(0.99, float64(f.passes)/float64(max(1, f.maxLen-1)))
}
