package engine

import (
	"math/bits"
	"slices"
)

// family is one algorithm's share of a stepper: the intervals that use it and whatever state it needs between
// passes. Families run side by side, one pass each per Step (decision E9).
type family interface {
	step(s *Stepper)
	done() bool
	// progress is the family's own 0..1 estimate; weight is its interval count, used to average the families.
	progress() float64
	weight() int
	// clone is an independent copy: stepping either never changes the other. Scratch buffers are fresh, not shared.
	clone() family
}

// Stepper advances a Plan one pass at a time on a live copy of the pixels, so a canvas can show pixels moving into
// place. Every algorithm only moves a pixel when its key is strictly greater than a neighbour's, so equal keys keep
// their order and the last frame equals Plan.Sort (PLAN.md 3.7, decision E9).
type Stepper struct {
	pl       *Plan
	live     []uint32 // the current pixels
	keys     []uint8  // per position: the key of the pixel currently there (keys travel with their pixel)
	fams     []family
	pass     int
	maxPass  int // upper bound from the families; see MaxPasses
	finished bool
	progMax  float64
	scratch  []uint32 // soft-blended preview, allocated on first use
}

// NewStepper starts a stepped sort of the plan. The plan itself is never modified.
func (pl *Plan) NewStepper() *Stepper {
	s := &Stepper{pl: pl, live: make([]uint32, len(pl.Orig)), keys: make([]uint8, len(pl.Keys))}
	copy(s.live, pl.Orig)
	copy(s.keys, pl.Keys)

	var oddEven, insertion, merge, reveal []int
	for i, a := range pl.Algos {
		switch a {
		case AlgoInsertion:
			insertion = append(insertion, i)
		case AlgoMerge:
			merge = append(merge, i)
		case AlgoReveal:
			reveal = append(reveal, i)
		default:
			oddEven = append(oddEven, i)
		}
	}
	if len(oddEven) > 0 {
		s.fams = append(s.fams, newOddEven(pl, oddEven))
	}
	if len(insertion) > 0 {
		s.fams = append(s.fams, newInsertion(pl, insertion))
	}
	if len(merge) > 0 {
		s.fams = append(s.fams, newMerge(pl, merge))
	}
	if len(reveal) > 0 {
		s.fams = append(s.fams, newReveal(pl, reveal))
	}
	s.maxPass = pl.MaxPasses()
	s.finished = s.allDone()
	return s
}

// MaxPasses is an upper bound on the passes NewStepper needs for this plan: stepping that many times always finishes,
// and the last image equals Sort. It is known before the first pass, so an animation can spread its frames over the whole
// sort. Odd-even stops early on two quiet passes, so the bound can be a few passes loose.
func (pl *Plan) MaxPasses() int {
	var maxLen, count [4]int
	for i, a := range pl.Algos {
		slot := 0
		switch a {
		case AlgoInsertion:
			slot = 1
		case AlgoMerge:
			slot = 2
		case AlgoReveal:
			slot = 3
		}
		maxLen[slot] = max(maxLen[slot], int(pl.Intervals[i].B-pl.Intervals[i].A))
		count[slot]++
	}
	best := 0
	if count[0] > 0 {
		best = max(best, maxLen[0]+2) // n phases sort it, two quiet phases prove it
	}
	if count[1] > 0 {
		best = max(best, max(1, maxLen[1]-1)) // one element per pass after the first
	}
	if count[2] > 0 && maxLen[2] > 1 {
		best = max(best, bits.Len(uint(maxLen[2]-1))) // run widths double
	}
	if count[3] > 0 {
		chunk := max(6, (count[3]+159)/160)
		best = max(best, (count[3]+chunk-1)/chunk)
	}
	return best
}

func (s *Stepper) allDone() bool {
	for _, f := range s.fams {
		if !f.done() {
			return false
		}
	}
	return true
}

// Step runs one pass of every unfinished family and reports whether the whole sort is finished. Further calls after
// that change nothing.
func (s *Stepper) Step() (done bool) {
	if s.finished {
		return true
	}
	for _, f := range s.fams {
		if !f.done() {
			f.step(s)
		}
	}
	s.pass++
	s.finished = s.allDone()
	return s.finished
}

// Clone is an independent copy of the stepper at its current pass: the pixels, keys and every algorithm's own state. The
// plan is shared (it is never modified). Scrubbing keeps a few clones as checkpoints so a seek replays only the passes since the
// nearest one.
func (s *Stepper) Clone() *Stepper {
	c := &Stepper{
		pl:       s.pl,
		live:     slices.Clone(s.live),
		keys:     slices.Clone(s.keys),
		fams:     make([]family, len(s.fams)),
		pass:     s.pass,
		maxPass:  s.maxPass,
		finished: s.finished,
		progMax:  s.progMax,
	}
	for i, f := range s.fams {
		c.fams[i] = f.clone()
	}
	return c
}

// Done reports whether every family has finished.
func (s *Stepper) Done() bool { return s.finished }

// MaxPasses is an upper bound on the passes this stepper needs: stepping it that many times always finishes, and the
// last image equals Plan.Sort. It is known before the first pass, so an animation can spread its frames over the
// whole sort. It is a bound, not the exact count (odd-even stops early on two quiet passes).
func (s *Stepper) MaxPasses() int { return s.maxPass }

// Pass is the number of passes run so far.
func (s *Stepper) Pass() int { return s.pass }

// Progress is 0 to 1, never decreases, stays below 1 until the sort is done, and is exactly 1 then. Odd-even's
// share is only an estimate (it stops after two quiet passes), so monotonicity is enforced by keeping the maximum.
func (s *Stepper) Progress() float64 {
	if s.finished {
		return 1
	}
	var sum, weight float64
	for _, f := range s.fams {
		w := float64(f.weight())
		p := 1.0
		if !f.done() {
			p = f.progress()
		}
		sum += w * p
		weight += w
	}
	p := min(0.99, sum/weight)
	s.progMax = max(s.progMax, p)
	return s.progMax
}

// Image is what the canvas should show now. Without a soft mask it wraps the live buffer (no copy, valid until the
// next Step); with one it blends into a scratch buffer the stepper owns and returns that, so the preview and the
// final result agree.
func (s *Stepper) Image() *Image {
	if s.pl.soft == nil {
		return &Image{W: s.pl.W, H: s.pl.H, Pix: s.live}
	}
	if s.scratch == nil {
		s.scratch = make([]uint32, len(s.live))
	}
	blendSoft(s.scratch, s.live, s.pl.Orig, s.pl.soft)
	return &Image{W: s.pl.W, H: s.pl.H, Pix: s.scratch}
}

// Result is a fresh copy of Image, safe to keep.
func (s *Stepper) Result() *Image {
	im := s.Image()
	out := make([]uint32, len(im.Pix))
	copy(out, im.Pix)
	return &Image{W: im.W, H: im.H, Pix: out}
}

// maxLen is the longest interval among the given indexes.
func maxLen(pl *Plan, idx []int) int {
	m := 0
	for _, i := range idx {
		m = max(m, int(pl.Intervals[i].B-pl.Intervals[i].A))
	}
	return m
}

// swapAt exchanges two positions' pixels and keys.
func (s *Stepper) swapAt(a, b int32) {
	s.live[a], s.live[b] = s.live[b], s.live[a]
	s.keys[a], s.keys[b] = s.keys[b], s.keys[a]
}
