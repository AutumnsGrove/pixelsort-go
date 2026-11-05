package engine

// reveal is not a sorting algorithm: it finishes whole intervals, a chunk per pass, in scan order. It is the cheap
// progressive mode. Intervals are disjoint and untouched by other families, so the plan's own interval sorter
// can write straight into the live buffer.
type reveal struct {
	pl     *Plan
	idx    []int
	cursor int
	chunk  int
	order  []int32
}

func newReveal(pl *Plan, idx []int) *reveal {
	return &reveal{pl: pl, idx: idx, chunk: max(6, (len(idx)+159)/160), order: make([]int32, maxLen(pl, idx))}
}

func (f *reveal) step(s *Stepper) {
	end := min(len(f.idx), f.cursor+f.chunk)
	for ; f.cursor < end; f.cursor++ {
		f.pl.sortInterval(s.live, f.order, f.pl.Intervals[f.idx[f.cursor]])
	}
}

func (f *reveal) done() bool        { return f.cursor >= len(f.idx) }
func (f *reveal) weight() int       { return len(f.idx) }
func (f *reveal) progress() float64 { return float64(f.cursor) / float64(len(f.idx)) }

// clone copies the cursor; the order buffer is scratch, so the copy gets its own.
func (f *reveal) clone() family {
	c := *f
	c.order = make([]int32, len(f.order))
	return &c
}
