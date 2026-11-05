package engine_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

func reds(im *engine.Image) []uint8 {
	out := make([]uint8, len(im.Pix))
	for i, p := range im.Pix {
		out[i], _, _, _ = engine.Unpack(p)
	}
	return out
}

func recipe(algo engine.Algo) engine.Params {
	p := engine.DefaultParams()
	p.Mode, p.Key, p.Algo, p.Randomness = engine.ModeNone, engine.KeyRed, algo, 0
	return p
}

func mustPlan(t testing.TB, im *engine.Image, p engine.Params, o *engine.Options) *engine.Plan {
	t.Helper()
	pl, err := engine.NewPlan(im, p, o)
	if err != nil {
		t.Fatalf("NewPlan: %v", err)
	}
	return pl
}

// longest is the longest interval in a plan.
func longest(pl *engine.Plan) int {
	m := 0
	for _, iv := range pl.Intervals {
		m = max(m, int(iv.B-iv.A))
	}
	return m
}

// runToDone steps until done, failing if it takes more than limit passes.
// passLimit is a generous bound on passes: odd-even and insertion need about the longest interval, reveal needs
// one pass per few intervals.
func passLimit(pl *engine.Plan) int { return 2*longest(pl) + len(pl.Intervals) + 10 }

func runToDone(t testing.TB, s *engine.Stepper, limit int) {
	t.Helper()
	for !s.Done() {
		if s.Pass() > limit {
			t.Fatalf("not done after %d passes", s.Pass())
		}
		s.Step()
	}
}

func TestStepperOddEvenKnown(t *testing.T) {
	// Odd-even on 5 4 3 2 1. Pass 0 (even pairs 0-1, 2-3): 4 5 2 3 1. Pass 1 (odd pairs 1-2, 3-4): 4 2 5 1 3.
	// Pass 2 (even): 2 4 1 5 3. Pass 3 (odd): 2 1 4 3 5. Pass 4 (even): 1 2 3 4 5.
	s := mustPlan(t, redRow(5, 4, 3, 2, 1), recipe(engine.AlgoOddEven), nil).NewStepper()
	want := [][]uint8{{4, 5, 2, 3, 1}, {4, 2, 5, 1, 3}, {2, 4, 1, 5, 3}, {2, 1, 4, 3, 5}, {1, 2, 3, 4, 5}}
	for pass, w := range want {
		s.Step()
		if got := reds(s.Image()); !slices.Equal(got, w) {
			t.Fatalf("after pass %d: got %v, want %v", pass+1, got, w)
		}
	}
}

func TestStepperEqualsSortSmall(t *testing.T) {
	sizes := [][2]int{{97, 61}, {1, 40}, {40, 1}}
	modes := []engine.IntervalMode{engine.ModeRandom, engine.ModeWave, engine.ModeThreshold, engine.ModeEdges, engine.ModeNone}
	algos := []engine.Algo{engine.AlgoOddEven, engine.AlgoInsertion, engine.AlgoMerge, engine.AlgoReveal}
	for _, sz := range sizes {
		for _, algo := range algos {
			for _, mode := range modes {
				for _, angle := range []int{0, 30, 45, 90, 135, 217, 300} {
					p := engine.DefaultParams()
					p.Mode, p.Angle, p.Algo, p.Length = mode, angle, algo, 120
					pl := mustPlan(t, testutil.Gradient(sz[0], sz[1], 5), p, nil)
					s := pl.NewStepper()
					runToDone(t, s, passLimit(pl))
					if !slices.Equal(s.Result().Pix, pl.Sort().Pix) {
						t.Fatalf("%dx%d %s %s angle %d: stepper differs from Sort", sz[0], sz[1], algo, mode, angle)
					}
				}
			}
		}
	}
}

func TestStepAfterDoneIsNoop(t *testing.T) {
	pl := mustPlan(t, redRow(3, 1, 2), recipe(engine.AlgoOddEven), nil)
	s := pl.NewStepper()
	runToDone(t, s, 20)
	pass, pix := s.Pass(), slices.Clone(s.Image().Pix)
	if !s.Step() || s.Pass() != pass || !slices.Equal(pix, s.Image().Pix) {
		t.Fatal("a step after done changed something")
	}
}

func TestNothingToSortIsDoneAtOnce(t *testing.T) {
	p := recipe(engine.AlgoMerge)
	p.Mode = engine.ModeThreshold
	p.Lo, p.Hi = 250, 255 // nothing is bright enough
	pl := mustPlan(t, redRow(1, 2, 3), p, nil)
	s := pl.NewStepper()
	if !s.Done() || s.Progress() != 1 {
		t.Fatalf("done %v progress %v", s.Done(), s.Progress())
	}
}

func TestPassBound(t *testing.T) {
	for _, algo := range []engine.Algo{engine.AlgoOddEven, engine.AlgoInsertion, engine.AlgoMerge, engine.AlgoReveal} {
		pl := mustPlan(t, testutil.Gradient(64, 48, 1), func() engine.Params { p := recipe(algo); p.Key = engine.KeyLuma; return p }(), nil)
		s := pl.NewStepper()
		runToDone(t, s, passLimit(pl))
		if algo != engine.AlgoReveal && s.Pass() > longest(pl)+2 {
			t.Errorf("%s took %d passes for intervals of %d", algo, s.Pass(), longest(pl))
		}
	}
}

func TestInsertionKnownStates(t *testing.T) {
	s := mustPlan(t, redRow(3, 1, 2), recipe(engine.AlgoInsertion), nil).NewStepper()
	for pass, w := range [][]uint8{{1, 3, 2}, {1, 2, 3}} {
		s.Step()
		if got := reds(s.Image()); !slices.Equal(got, w) {
			t.Fatalf("after pass %d: got %v, want %v", pass+1, got, w)
		}
	}
	if !s.Done() || s.Pass() != 2 {
		t.Fatalf("done %v after %d passes, want done after len-1 = 2", s.Done(), s.Pass())
	}
}

func TestInsertionPassesEqualLenMinusOne(t *testing.T) {
	s := mustPlan(t, redRow(9, 8, 7, 6, 5, 4, 3, 2, 1), recipe(engine.AlgoInsertion), nil).NewStepper()
	runToDone(t, s, 20)
	if s.Pass() != 8 {
		t.Fatalf("%d passes, want 8", s.Pass())
	}
}

func TestMergeKnownStates(t *testing.T) {
	s := mustPlan(t, redRow(4, 3, 2, 1), recipe(engine.AlgoMerge), nil).NewStepper()
	for pass, w := range [][]uint8{{3, 4, 1, 2}, {1, 2, 3, 4}} {
		s.Step()
		if got := reds(s.Image()); !slices.Equal(got, w) {
			t.Fatalf("after pass %d: got %v, want %v", pass+1, got, w)
		}
	}
	if !s.Done() {
		t.Fatal("not done after 2 passes")
	}
}

func TestMergePassCount(t *testing.T) {
	vals := make([]uint8, 1000)
	for i := range vals {
		vals[i] = uint8((i * 37) & 255)
	}
	s := mustPlan(t, redRow(vals...), recipe(engine.AlgoMerge), nil).NewStepper()
	runToDone(t, s, 30)
	if s.Pass() != 10 {
		t.Fatalf("%d passes, want 10", s.Pass())
	}
}

func TestMergeIsStable(t *testing.T) {
	im := testutil.UniqueIDImage(40, 25)
	p := recipe(engine.AlgoMerge)
	p.Angle = 90
	pl := mustPlan(t, im, p, nil)
	s := pl.NewStepper()
	runToDone(t, s, 40)
	if !slices.Equal(s.Result().Pix, pl.Sort().Pix) {
		t.Fatal("merge reordered equal keys")
	}
}

func TestRevealChunks(t *testing.T) {
	// 50 intervals: chunk = max(6, ceil(50/160)) = 6, so ceil(50/6) = 9 passes.
	vals := make([]uint8, 100)
	for i := range vals {
		vals[i] = uint8(100 - i)
	}
	p := recipe(engine.AlgoReveal)
	p.Mode, p.Length = engine.ModeRandom, 1 // very short intervals
	pl := mustPlan(t, redRow(vals...), p, nil)
	n := len(pl.Intervals)
	want := (n + 5) / 6
	s := pl.NewStepper()
	runToDone(t, s, n+2)
	if s.Pass() != want {
		t.Fatalf("%d intervals took %d passes, want %d", n, s.Pass(), want)
	}
}

func TestProgress(t *testing.T) {
	for _, algo := range []engine.Algo{engine.AlgoOddEven, engine.AlgoInsertion, engine.AlgoMerge, engine.AlgoReveal} {
		pl := mustPlan(t, testutil.Gradient(50, 30, 2), func() engine.Params { p := recipe(algo); p.Key = engine.KeyLuma; return p }(), nil)
		s := pl.NewStepper()
		prev := s.Progress()
		for !s.Done() {
			s.Step()
			p := s.Progress()
			if p < prev {
				t.Fatalf("%s: progress fell from %v to %v", algo, prev, p)
			}
			if !s.Done() && p >= 1 {
				t.Fatalf("%s: progress %v before done", algo, p)
			}
			prev = p
		}
		if s.Progress() != 1 {
			t.Fatalf("%s: progress %v at done", algo, s.Progress())
		}
	}
}

// All four algorithms in one image, one per class, finish together and match Sort.
func TestAllFamiliesFinishTogether(t *testing.T) {
	im := testutil.Gradient(48, 40, 4)
	cells := testutil.GridCells(48, 40, 12)
	classOf := make([]uint8, 17)
	for i := 1; i < len(classOf); i++ {
		classOf[i] = uint8(i%4 + 1)
	}
	algos := []engine.Algo{engine.AlgoOddEven, engine.AlgoInsertion, engine.AlgoMerge, engine.AlgoReveal}
	defs := make([]engine.ClassDef, 5)
	for c := 1; c <= 4; c++ {
		a := algos[c-1]
		defs[c] = engine.ClassDef{Algo: &a}
	}
	p := engine.DefaultParams()
	p.Mode, p.Randomness, p.Key = engine.ModeNone, 0, engine.KeyLuma
	pl := mustPlan(t, im, p, &engine.Options{Regions: &engine.Regions{Labels: cells, ClassOf: classOf, Defs: defs}})
	s := pl.NewStepper()
	runToDone(t, s, passLimit(pl))
	if !slices.Equal(s.Result().Pix, pl.Sort().Pix) {
		t.Fatal("mixed stepper differs from Sort")
	}
	before := slices.Clone(s.Image().Pix)
	s.Step()
	if !slices.Equal(before, s.Image().Pix) {
		t.Fatal("changed after done")
	}
}

func TestSoftBlendWhileStepping(t *testing.T) {
	im := testutil.Gradient(30, 20, 6)
	n := 30 * 20
	for _, tc := range []struct {
		name  string
		alpha uint8
	}{{"all 255 keeps the original", 255}, {"all 0 shows the sort", 0}} {
		t.Run(tc.name, func(t *testing.T) {
			soft := make([]uint8, n)
			for i := range soft {
				soft[i] = tc.alpha
			}
			p := engine.DefaultParams()
			p.Length = 300
			p.Algo = engine.AlgoInsertion
			pl := mustPlan(t, im, p, &engine.Options{Soft: soft})
			s := pl.NewStepper()
			for !s.Done() {
				s.Step()
				if tc.alpha == 255 && !slices.Equal(s.Image().Pix, im.Pix) {
					t.Fatal("soft 255 must show the original at every pass")
				}
			}
			if !slices.Equal(s.Result().Pix, pl.Sort().Pix) {
				t.Fatal("Result differs from Sort")
			}
		})
	}
}
