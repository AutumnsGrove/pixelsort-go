package engine

// oddEven is odd-even transposition sort: each pass compares every other neighbouring pair, alternating which
// pairs, and swaps only when the left key is strictly greater. It is finished after two quiet passes in a row.
type oddEven struct {
	pl     *Plan
	idx    []int
	maxLen int
	quiet  int
	passes int
}

func newOddEven(pl *Plan, idx []int) *oddEven {
	return &oddEven{pl: pl, idx: idx, maxLen: maxLen(pl, idx)}
}

func (f *oddEven) step(s *Stepper) {
	par := s.pass & 1
	swaps := 0
	line := f.pl.Lines.P
	for _, i := range f.idx {
		iv := f.pl.Intervals[i]
		a0, a1 := int(iv.A), int(iv.B)
		for t := a0 + ((a0 ^ par) & 1); t+1 < a1; t += 2 {
			a, b := line[t], line[t+1]
			if s.keys[a] > s.keys[b] {
				s.swapAt(a, b)
				swaps++
			}
		}
	}
	f.passes++
	if swaps == 0 {
		f.quiet++
	} else {
		f.quiet = 0
	}
}

func (f *oddEven) done() bool  { return f.quiet >= 2 }
func (f *oddEven) weight() int { return len(f.idx) }
func (f *oddEven) progress() float64 {
	return min(0.99, float64(f.passes)/float64(f.maxLen))
}
