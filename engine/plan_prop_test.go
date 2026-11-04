package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
	"pgregory.net/rapid"
)

// TestProp_PlanInvariants is the contract every plan must satisfy, whatever the recipe: intervals are inside one
// line, never overlap, never include a frozen pixel, never cross a cell, are at least two pixels long, and the
// stats match the lists.
func TestProp_PlanInvariants(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		im := testutil.ImageGen(24, 24).Draw(t, "image")
		p := testutil.ParamsGenNoCA().Draw(t, "params")
		o := &engine.Options{}
		if rapid.Bool().Draw(t, "withRegions") {
			o.Regions = testutil.RegionsGen(im.W, im.H).Draw(t, "regions")
		} else if rapid.Bool().Draw(t, "withMask") {
			o.Mask = rapid.SliceOfN(rapid.Byte(), im.W*im.H, im.W*im.H).Draw(t, "mask")
		}
		pl, err := engine.NewPlan(im, p, o)
		if err != nil {
			t.Fatalf("NewPlan: %v", err)
		}

		if pl.Stats.Lines != len(pl.Lines.Starts)-1 {
			t.Fatalf("stats says %d lines, Starts says %d", pl.Stats.Lines, len(pl.Lines.Starts)-1)
		}
		if pl.Stats.Intervals != len(pl.Intervals) || pl.Stats.Intervals != len(pl.Algos) {
			t.Fatalf("%d intervals and %d algos, stats says %d", len(pl.Intervals), len(pl.Algos), pl.Stats.Intervals)
		}

		// Which line each position of P belongs to.
		lineOf := make([]int, len(pl.Lines.P))
		for l := 0; l < len(pl.Lines.Starts)-1; l++ {
			for i := pl.Lines.Starts[l]; i < pl.Lines.Starts[l+1]; i++ {
				lineOf[i] = l
			}
		}

		sortable, frozen := 0, 0
		for i := range im.Pix {
			if frozenAt(i, im, p, o) {
				frozen++
			}
		}
		var prev engine.Interval
		for n, iv := range pl.Intervals {
			if iv.A >= iv.B {
				t.Fatalf("interval %d is empty: %v", n, iv)
			}
			if iv.B-iv.A < 2 {
				t.Fatalf("interval %d is %d pixels long: %v", n, iv.B-iv.A, iv)
			}
			if lineOf[iv.A] != lineOf[iv.B-1] {
				t.Fatalf("interval %d (%v) spans lines %d and %d", n, iv, lineOf[iv.A], lineOf[iv.B-1])
			}
			if n > 0 && prev.B > iv.A {
				t.Fatalf("intervals %v and %v overlap", prev, iv)
			}
			prev = iv
			var cell uint16
			if o.Regions != nil {
				cell = o.Regions.Labels[pl.Lines.P[iv.A]]
			}
			for i := iv.A; i < iv.B; i++ {
				pos := pl.Lines.P[i]
				if frozenAt(int(pos), im, p, o) {
					t.Fatalf("interval %d (%v) contains frozen pixel %d", n, iv, pos)
				}
				if o.Regions != nil && o.Regions.Labels[pos] != cell {
					t.Fatalf("interval %d (%v) crosses cells %d and %d", n, iv, cell, o.Regions.Labels[pos])
				}
			}
			sortable += int(iv.B - iv.A)
		}
		if pl.Stats.SortablePixels != sortable {
			t.Fatalf("stats says %d sortable pixels, intervals hold %d", pl.Stats.SortablePixels, sortable)
		}
		if pl.Stats.FrozenPixels != frozen {
			t.Fatalf("stats says %d frozen pixels, freeze test says %d", pl.Stats.FrozenPixels, frozen)
		}
	})
}

// frozenAt repeats the engine's freeze rule from the outside, so the property is checked against the specification
// rather than against the implementation's own bookkeeping.
func frozenAt(i int, im *engine.Image, p engine.Params, o *engine.Options) bool {
	if o.Mask != nil && o.Mask[i] != 0 {
		return true
	}
	eff := p
	if o.Regions != nil {
		class := o.Regions.ClassOf[o.Regions.Labels[i]]
		if o.Regions.Defs[class].Frozen {
			return true
		}
		eff = p.With(o.Regions.Defs[class])
	}
	if eff.Mode == engine.ModeThreshold {
		thr := engine.KeyFor(p.ThresholdKey, false)(im.Pix[i])
		if int(thr) < eff.Lo || int(thr) > eff.Hi {
			return true
		}
	}
	return false
}
