package engine_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
	"pgregory.net/rapid"
)

// stepperInput draws a small image, a recipe without ca, and optionally regions (each class with its own
// algorithm), a mask and a soft plane.
func stepperInput(t *rapid.T) (*engine.Image, engine.Params, *engine.Options) {
	im := testutil.ImageGen(20, 20).Draw(t, "image")
	p := testutil.ParamsGen().Draw(t, "params")
	o := &engine.Options{}
	switch rapid.IntRange(0, 3).Draw(t, "extras") {
	case 1:
		o.Regions = testutil.RegionsGen(im.W, im.H).Draw(t, "regions")
		algos := []engine.Algo{engine.AlgoOddEven, engine.AlgoInsertion, engine.AlgoMerge, engine.AlgoReveal}
		for c := range o.Regions.Defs {
			a := rapid.SampledFrom(algos).Draw(t, "classAlgo")
			o.Regions.Defs[c].Algo = &a
		}
	case 2:
		o.Mask = rapid.SliceOfN(rapid.Byte(), im.W*im.H, im.W*im.H).Draw(t, "mask")
	case 3:
		o.Soft = rapid.SliceOfN(rapid.Byte(), im.W*im.H, im.W*im.H).Draw(t, "soft")
	}
	return im, p, o
}

func sortedCopy(px []uint32) []uint32 {
	c := slices.Clone(px)
	slices.Sort(c)
	return c
}

// Property 5: stepping to completion equals the instant sort, for every algorithm, mode and angle.
func TestProp_StepperEqualsSort(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		im, p, o := stepperInput(t)
		pl, err := engine.NewPlan(im, p, o)
		if err != nil {
			t.Fatal(err)
		}
		s := pl.NewStepper()
		limit := passLimit(pl)
		for !s.Done() {
			if s.Pass() > limit {
				t.Fatalf("not done after %d passes", s.Pass())
			}
			s.Step()
		}
		if !slices.Equal(s.Result().Pix, pl.Sort().Pix) {
			t.Fatal("stepper result differs from Sort")
		}
	})
}

// After every pass the live image is a permutation of the input, and frozen pixels have not moved. (Soft planes
// blend, so only the hard cases are checked here.)
func TestProp_EveryPassIsAPermutation(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		im, p, o := stepperInput(t)
		o.Soft = nil
		pl, err := engine.NewPlan(im, p, o)
		if err != nil {
			t.Fatal(err)
		}
		inSorted := sortedCopy(im.Pix)
		inInterval := make([]bool, len(im.Pix))
		for _, iv := range pl.Intervals {
			for i := iv.A; i < iv.B; i++ {
				inInterval[pl.Lines.P[i]] = true
			}
		}
		s := pl.NewStepper()
		for !s.Done() && s.Pass() < passLimit(pl) {
			s.Step()
			live := s.Image().Pix
			if !slices.Equal(sortedCopy(live), inSorted) {
				t.Fatalf("pass %d: not a permutation of the input", s.Pass())
			}
			for pos, moves := range inInterval {
				if !moves && live[pos] != im.Pix[pos] {
					t.Fatalf("pass %d: pixel %d is not in any interval but moved", s.Pass(), pos)
				}
			}
		}
	})
}

func TestProp_ProgressMonotone(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		im, p, o := stepperInput(t)
		pl, err := engine.NewPlan(im, p, o)
		if err != nil {
			t.Fatal(err)
		}
		s := pl.NewStepper()
		prev := s.Progress()
		for !s.Done() && s.Pass() < passLimit(pl) {
			s.Step()
			cur := s.Progress()
			if cur < prev || (cur >= 1) != s.Done() {
				t.Fatalf("progress %v then %v (done %v)", prev, cur, s.Done())
			}
			prev = cur
		}
	})
}
