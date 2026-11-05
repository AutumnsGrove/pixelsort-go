package engine_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// TestStepperCloneContinuesIdentically: at any pass, a clone carries on exactly as the original does (same pixels after
// every further pass, same pass count, same progress and done), for every algorithm and for mixed per-class algorithms.
func TestStepperCloneContinuesIdentically(t *testing.T) {
	im := testutil.Gradient(48, 36, 5)
	for _, algo := range []engine.Algo{engine.AlgoOddEven, engine.AlgoInsertion, engine.AlgoMerge, engine.AlgoReveal} {
		t.Run(string(algo), func(t *testing.T) {
			pl := mustPlan(t, im, recipe(algo), nil)
			total := stepsToDone(t, pl)
			for _, at := range []int{0, 1, total / 3, total / 2, total - 1, total} {
				orig := pl.NewStepper()
				for orig.Pass() < at {
					if orig.Step() {
						break
					}
				}
				clone := orig.Clone()
				for k := 0; k < total+2; k++ {
					d1, d2 := orig.Step(), clone.Step()
					if d1 != d2 || orig.Pass() != clone.Pass() || orig.Progress() != clone.Progress() {
						t.Fatalf("at %d, +%d: done %v/%v pass %d/%d", at, k, d1, d2, orig.Pass(), clone.Pass())
					}
					if !slices.Equal(orig.Image().Pix, clone.Image().Pix) {
						t.Fatalf("at %d, +%d: pixels differ", at, k)
					}
				}
			}
		})
	}
}

// TestStepperCloneIsIndependent: stepping the original must not change a clone, nor the other way round.
func TestStepperCloneIsIndependent(t *testing.T) {
	im := testutil.Gradient(48, 36, 5)
	pl := mustPlan(t, im, recipe(engine.AlgoInsertion), nil)
	orig := pl.NewStepper()
	for range 5 {
		orig.Step()
	}
	clone := orig.Clone()
	frozen := slices.Clone(clone.Image().Pix)
	passAtClone := clone.Pass()
	for range 10 {
		orig.Step()
	}
	if !slices.Equal(clone.Image().Pix, frozen) || clone.Pass() != passAtClone {
		t.Fatal("stepping the original changed the clone")
	}
	origPix := slices.Clone(orig.Image().Pix)
	for range 10 {
		clone.Step()
	}
	if !slices.Equal(orig.Image().Pix, origPix) {
		t.Fatal("stepping the clone changed the original")
	}
}

func stepsToDone(t *testing.T, pl *engine.Plan) int {
	t.Helper()
	s := pl.NewStepper()
	for n := 0; n < passLimit(pl); n++ {
		if s.Step() {
			return s.Pass()
		}
	}
	t.Fatal("did not finish")
	return 0
}
