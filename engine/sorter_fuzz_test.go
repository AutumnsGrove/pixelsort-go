package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// FuzzPlanAndSort looks for panics and invariant breaks on recipes nobody would type: every draw is clamped into
// a valid range rather than skipped, so each execution still sorts something.
func FuzzPlanAndSort(f *testing.F) {
	f.Add(8, 8, 0, 0, 83, 10, 7)
	f.Add(1, 1, 45, 1, 1000, 0, 1)
	f.Add(40, 40, 179, 2, 1, 100, 99)
	f.Add(2, 40, 270, 3, 500, 50, 3)
	f.Add(40, 2, -90, 4, 250, 0, 0)
	f.Fuzz(func(t *testing.T, w, h, angle, mode, length, randomness, seed int) {
		w = clampInt(w, 1, 40)
		h = clampInt(h, 1, 40)
		angle = ((angle % 360) + 360) % 360
		modes := []engine.IntervalMode{engine.ModeRandom, engine.ModeWave, engine.ModeThreshold,
			engine.ModeEdges, engine.ModeNone}
		p := engine.DefaultParams()
		p.Mode = modes[clampInt(mode, 0, len(modes)-1)]
		p.Angle = angle
		p.Length = clampInt(length, 1, 1000)
		p.Randomness = clampInt(randomness, 0, 100)
		p.Seed = uint32(seed)
		im := testutil.Gradient(w, h, p.Seed)
		pl, err := engine.NewPlan(im, p, nil)
		if err != nil {
			t.Fatalf("NewPlan: %v", err)
		}
		out := pl.Sort()
		checkPermutation(t, im, out)
		for i := range im.Pix {
			if frozenAt(i, im, p, &engine.Options{}) && out.Pix[i] != im.Pix[i] {
				t.Fatalf("frozen pixel %d moved", i)
			}
		}
	})
}
