package engine

import (
	"errors"
	"fmt"
)

// Interval is a half-open range of indexes into Plan.Lines.P: the pixels P[A:B] are sorted together.
type Interval struct{ A, B int32 }

// Options are the optional inputs to a plan besides the image and the recipe.
type Options struct {
	Regions *Regions // nil = the whole image is one region
	Mask    []uint8  // len W*H or nil; non-zero = frozen (a hard barrier that never moves)
	Soft    []uint8  // len W*H or nil; 0..255 alpha blending the result back toward the original (feather)
}

// Stats describes what a plan decided to do, for the UI and for tests.
type Stats struct {
	Lines          int
	Intervals      int
	SortablePixels int
	FrozenPixels   int
}

// Plan is everything expensive about a sort, computed once: per-pixel keys, the line partition and the list of
// intervals. It is immutable after NewPlan, so Sort can be called as often as a caller likes and always returns
// the same image (PLAN.md 3.1). The stepper copies what it mutates.
type Plan struct {
	W, H      int
	Orig      []uint32 // the input pixels; not copied, and never mutated by the Plan
	Keys      []uint8  // per pixel position
	Lines     Lines
	Intervals []Interval
	Algos     []Algo // per interval, from its class's effective params
	Stats     Stats
	soft      []uint8 // the Soft option, kept for Sort's final blend
}

// ErrNotImplemented marks behaviour a later phase adds. Today only the cellular-automaton modes use it.
var ErrNotImplemented = errors.New("engine: not implemented yet")

// NewPlan validates the recipe and the options, then decides every key, line and interval. It returns
// ErrNotImplemented for the ca modes, which arrive in phase 4.
func NewPlan(im *Image, p Params, o *Options) (*Plan, error) {
	if im == nil {
		return nil, errors.New("engine: NewPlan: nil image")
	}
	if err := p.Validate(); err != nil {
		return nil, err
	}
	var opts Options
	if o != nil {
		opts = *o
	}
	n := im.W * im.H
	if opts.Mask != nil && len(opts.Mask) != n {
		return nil, fmt.Errorf("engine: mask has %d bytes for a %dx%d image: %w", len(opts.Mask), im.W, im.H, ErrBadData)
	}
	if opts.Soft != nil && len(opts.Soft) != n {
		return nil, fmt.Errorf("engine: soft mask has %d bytes for a %dx%d image: %w", len(opts.Soft), im.W, im.H, ErrBadData)
	}
	if err := opts.Regions.Validate(im.W, im.H); err != nil {
		return nil, err
	}

	// One effective recipe per region class. Without regions there is a single class, 0.
	var classes []uint8
	nClasses := 1
	if opts.Regions != nil {
		classes = opts.Regions.classes(im.W, im.H)
		nClasses = len(opts.Regions.Defs)
	}
	eff := make([]Params, nClasses)
	frozenClass := make([]bool, nClasses)
	for c := 0; c < nClasses; c++ {
		eff[c] = p
		if opts.Regions != nil && c < len(opts.Regions.Defs) {
			eff[c] = p.With(opts.Regions.Defs[c])
			frozenClass[c] = opts.Regions.Defs[c].Frozen
		}
		if err := eff[c].Validate(); err != nil {
			if opts.Regions != nil {
				return nil, fmt.Errorf("engine: class %d: %w", c, err)
			}
			return nil, err
		}
		if eff[c].Mode == ModeCA || eff[c].Mode == ModeCAEdges {
			return nil, fmt.Errorf("engine: mode %q arrives in phase 4: %w", eff[c].Mode, ErrNotImplemented)
		}
	}

	classAt := func(pos int) uint8 {
		if classes == nil {
			return 0
		}
		return classes[pos]
	}

	// Keys, one byte per pixel, using the class's own key and direction.
	keyFns := make([]KeyFunc, nClasses)
	for c := range eff {
		keyFns[c] = KeyFor(eff[c].Key, eff[c].Reverse)
	}
	keys := make([]uint8, n)
	for i, px := range im.Pix {
		keys[i] = keyFns[classAt(i)](px)
	}

	// The threshold metric is global: a class may override the band, not the metric it is measured with.
	thrFn := KeyFor(p.ThresholdKey, false)
	thr := make([]uint8, n)
	for i, px := range im.Pix {
		thr[i] = thrFn(px)
	}

	needEdges := false
	for c := range eff {
		if eff[c].Mode == ModeEdges {
			needEdges = true
		}
	}
	var edges []uint8
	if needEdges {
		lumaFn := KeyFor(KeyLuma, false)
		lum := make([]uint8, n)
		for i, px := range im.Pix {
			lum[i] = lumaFn(px)
		}
		edges = EdgeMap(lum, im.W, im.H)
	}

	frozen := make([]bool, n)
	frozenPixels := 0
	for i := range frozen {
		c := classAt(i)
		frozen[i] = (opts.Mask != nil && opts.Mask[i] != 0) || frozenClass[c] ||
			(eff[c].Mode == ModeThreshold && (int(thr[i]) < eff[c].Lo || int(thr[i]) > eff[c].Hi))
		if frozen[i] {
			frozenPixels++
		}
	}

	pl := &Plan{
		W: im.W, H: im.H, Orig: im.Pix, Keys: keys,
		Lines: PartitionRegions(im.W, im.H, p.Angle, opts.Regions),
		Stats: Stats{Lines: 0, FrozenPixels: frozenPixels},
		soft:  opts.Soft,
	}
	pl.Stats.Lines = len(pl.Lines.Starts) - 1
	pl.buildIntervals(p, eff, classAt, frozen, edges)
	return pl, nil
}

// buildIntervals walks every line, cuts its runs of unfrozen pixels, and records the segments that are long enough
// and lucky enough to sort.
func (pl *Plan) buildIntervals(p Params, eff []Params, classAt func(int) uint8, frozen []bool, edges []uint8) {
	nLines := len(pl.Lines.Starts) - 1
	segs := make([][2]int, 0, 16)
	for l := 0; l < nLines; l++ {
		lineStart, lineEnd := int(pl.Lines.Starts[l]), int(pl.Lines.Starts[l+1])
		// One stream per line, seeded only by (recipe seed, line number): the intervals of a line cannot move when
		// other lines appear or disappear (determinism rule 1, PLAN.md 3.1).
		rng := NewStream(p.Seed, uint32(l))
		for t := lineStart; t < lineEnd; {
			if frozen[pl.Lines.P[t]] {
				t++
				continue
			}
			r0 := t
			for t < lineEnd && !frozen[pl.Lines.P[t]] {
				t++
			}
			r1 := t
			cp := eff[classAt(int(pl.Lines.P[r0]))]
			segs = pl.cutSegments(segs[:0], l, lineStart, r0, r1, cp, rng, edges)
			for _, s := range segs {
				if s[1]-s[0] < 2 {
					continue
				}
				// The skip draw happens for every sortable segment, whether or not randomness is on, so the draw
				// order is the same at every randomness setting.
				if int(rng.Uint32n(10000)) < cp.Randomness*100 {
					continue
				}
				pl.Intervals = append(pl.Intervals, Interval{A: pos32(s[0]), B: pos32(s[1])})
				pl.Algos = append(pl.Algos, cp.Algo)
				pl.Stats.SortablePixels += s[1] - s[0]
			}
		}
	}
	pl.Stats.Intervals = len(pl.Intervals)
}

// pixels converts a per-mille value to pixels at a given width, never below one (decision E4).
func pixels(v, w int) int { return max(1, (w*v+500)/1000) }
