package engine_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
	"pgregory.net/rapid"
)

// MaxPasses is what the animation sampler asks for before it has run the sort. It must be an upper bound: stepping
// that many passes always reaches the finished image, whatever the recipe.
func TestMaxPassesCoversEveryAlgo(t *testing.T) {
	sizes := [][2]int{{97, 61}, {1, 40}, {40, 1}, {64, 64}}
	modes := []engine.IntervalMode{engine.ModeRandom, engine.ModeWave, engine.ModeThreshold, engine.ModeEdges, engine.ModeNone}
	algos := []engine.Algo{engine.AlgoOddEven, engine.AlgoInsertion, engine.AlgoMerge, engine.AlgoReveal}
	for _, sz := range sizes {
		for _, algo := range algos {
			for _, mode := range modes {
				for _, angle := range []int{0, 45, 90, 217} {
					p := engine.DefaultParams()
					p.Mode, p.Angle, p.Algo, p.Length = mode, angle, algo, 120
					pl := mustPlan(t, testutil.Gradient(sz[0], sz[1], 5), p, nil)
					s := pl.NewStepper()
					maxPasses := s.MaxPasses()
					if maxPasses < 0 {
						t.Fatalf("%dx%d %s %s angle %d: negative MaxPasses %d", sz[0], sz[1], algo, mode, angle, maxPasses)
					}
					for !s.Done() && s.Pass() < maxPasses {
						s.Step()
					}
					if !s.Done() {
						t.Fatalf("%dx%d %s %s angle %d: not done after MaxPasses %d", sz[0], sz[1], algo, mode, angle, maxPasses)
					}
					if !slices.Equal(s.Result().Pix, pl.Sort().Pix) {
						t.Fatalf("%dx%d %s %s angle %d: final frame differs from Sort", sz[0], sz[1], algo, mode, angle)
					}
				}
			}
		}
	}
}

func TestProp_MaxPassesReachesTheResult(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		im := testutil.ImageGen(40, 30).Draw(t, "image")
		p := testutil.ParamsGen().Draw(t, "params")
		pl, err := engine.NewPlan(im, p, nil)
		if err != nil {
			t.Fatalf("NewPlan: %v", err)
		}
		s := pl.NewStepper()
		for !s.Done() && s.Pass() < s.MaxPasses() {
			s.Step()
		}
		if !s.Done() {
			t.Fatalf("not done after MaxPasses %d (mode %s, algo %s)", s.MaxPasses(), p.Mode, p.Algo)
		}
		if !slices.Equal(s.Result().Pix, pl.Sort().Pix) {
			t.Fatal("final frame differs from Sort")
		}
	})
}

// The bound is not useful if it is wildly loose: the live UI shows its progress, and the sampler spreads frames over
// it. Allow the detection passes odd-even needs plus one.
func TestMaxPassesStaysCloseToTheWork(t *testing.T) {
	for _, algo := range []engine.Algo{engine.AlgoOddEven, engine.AlgoInsertion, engine.AlgoMerge, engine.AlgoReveal} {
		t.Run(string(algo), func(t *testing.T) {
			pl := mustPlan(t, testutil.Gradient(200, 120, 7), recipe(algo), nil)
			actual := stepsToDone(t, pl)
			maxPasses := pl.NewStepper().MaxPasses()
			slack := max(2, longest(pl)/5)
			if maxPasses > actual+slack {
				t.Fatalf("%s: MaxPasses %d is far above the %d passes it takes", algo, maxPasses, actual)
			}
		})
	}
}
