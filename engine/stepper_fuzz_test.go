package engine_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// FuzzStepperEqualsInstant: bytes choose a size, a recipe, an algorithm per class; stepping to done equals Sort and
// never takes an absurd number of passes.
func FuzzStepperEqualsInstant(f *testing.F) {
	f.Add([]byte{9, 7, 45, 1, 2, 3, 4})
	f.Add([]byte{1, 30, 0, 0, 0, 0, 0})
	f.Add([]byte{31, 31, 217, 3, 3, 1, 2})
	f.Fuzz(func(t *testing.T, data []byte) {
		at := func(i int) int {
			if i < len(data) {
				return int(data[i])
			}
			return 0
		}
		w, h := at(0)%32+1, at(1)%32+1
		algos := []engine.Algo{engine.AlgoOddEven, engine.AlgoInsertion, engine.AlgoMerge, engine.AlgoReveal}
		modes := []engine.IntervalMode{engine.ModeRandom, engine.ModeWave, engine.ModeThreshold, engine.ModeEdges, engine.ModeNone}
		p := engine.DefaultParams()
		p.Angle = at(2) * 360 / 256
		p.Mode = modes[at(3)%len(modes)]
		p.Algo = algos[at(4)%len(algos)]
		p.Length = at(5)%200 + 1
		p.Seed = uint32(at(6))
		o := &engine.Options{}
		if at(7)%2 == 1 {
			cells := testutil.GridCells(w, h, at(8)%8+1)
			classOf := testutil.ClassPattern(int(slices.Max(cells)), "random", uint32(at(9)))
			defs := make([]engine.ClassDef, 5)
			for c := range defs {
				a := algos[(at(10)+c)%len(algos)]
				defs[c] = engine.ClassDef{Algo: &a}
			}
			o.Regions = &engine.Regions{Labels: cells, ClassOf: classOf, Defs: defs}
		}
		pl, err := engine.NewPlan(testutil.Gradient(w, h, uint32(at(11))), p, o)
		if err != nil {
			t.Skip()
		}
		s := pl.NewStepper()
		for !s.Done() {
			if s.Pass() > passLimit(pl) {
				t.Fatalf("not done after %d passes", s.Pass())
			}
			s.Step()
		}
		if !slices.Equal(s.Result().Pix, pl.Sort().Pix) {
			t.Fatal("stepper differs from Sort")
		}
	})
}
