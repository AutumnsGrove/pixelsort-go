package engine_test

import (
	"sort"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
	"pgregory.net/rapid"
)

// TestProp_Permutation is property 2: sorting rearranges pixels and never invents or loses one.
func TestProp_Permutation(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		im := testutil.ImageGen(30, 30).Draw(t, "image")
		p := testutil.ParamsGenNoCA().Draw(t, "params")
		pl, err := engine.NewPlan(im, p, nil)
		if err != nil {
			t.Fatalf("NewPlan: %v", err)
		}
		checkPermutation(t, im, pl.Sort())
	})
}

// TestProp_IntervalsSorted is property 1: along every interval the class's key is non-decreasing. Ties stay in their
// original order, which TestSortStableTies and the oracle check pin down.
func TestProp_IntervalsSorted(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		im := testutil.ImageGen(30, 30).Draw(t, "image")
		p := testutil.ParamsGenNoCA().Draw(t, "params")
		o := &engine.Options{}
		if rapid.Bool().Draw(t, "withRegions") {
			o.Regions = testutil.RegionsGen(im.W, im.H).Draw(t, "regions")
		}
		pl, err := engine.NewPlan(im, p, o)
		if err != nil {
			t.Fatalf("NewPlan: %v", err)
		}
		out := pl.Sort()
		for n, iv := range pl.Intervals {
			key := classKey(pl, o, im, p, int(iv.A))
			for i := iv.A; i+1 < iv.B; i++ {
				a, b := pl.Lines.P[i], pl.Lines.P[i+1]
				if key(out.Pix[a]) > key(out.Pix[b]) {
					t.Fatalf("interval %d (%v) is not sorted at offset %d: %d > %d",
						n, iv, i-iv.A, key(out.Pix[a]), key(out.Pix[b]))
				}
			}
		}
	})
}

// TestProp_FrozenNeverMove is property 3: a frozen pixel is byte-identical after the sort.
func TestProp_FrozenNeverMove(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		im := testutil.ImageGen(30, 30).Draw(t, "image")
		p := testutil.ParamsGenNoCA().Draw(t, "params")
		o := &engine.Options{}
		switch rapid.IntRange(0, 2).Draw(t, "freeze") {
		case 1:
			o.Mask = rapid.SliceOfN(rapid.Byte(), im.W*im.H, im.W*im.H).Draw(t, "mask")
		case 2:
			o.Regions = testutil.RegionsGen(im.W, im.H).Draw(t, "regions")
		}
		pl, err := engine.NewPlan(im, p, o)
		if err != nil {
			t.Fatalf("NewPlan: %v", err)
		}
		out := pl.Sort()
		for i := range im.Pix {
			if frozenAt(i, im, p, o) && out.Pix[i] != im.Pix[i] {
				t.Fatalf("frozen pixel %d moved", i)
			}
		}
	})
}

// TestProp_Deterministic is property 4: the same recipe gives a byte-identical image, twice over.
func TestProp_Deterministic(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		im := testutil.ImageGen(24, 24).Draw(t, "image")
		p := testutil.ParamsGenNoCA().Draw(t, "params")
		a, err := engine.NewPlan(im, p, nil)
		if err != nil {
			t.Fatalf("NewPlan: %v", err)
		}
		b, err := engine.NewPlan(im, p, nil)
		if err != nil {
			t.Fatalf("NewPlan: %v", err)
		}
		first, second := a.Sort(), b.Sort()
		for i := range first.Pix {
			if first.Pix[i] != second.Pix[i] {
				t.Fatalf("two runs differ at %d", i)
			}
		}
	})
}

// TestProp_OracleSliceStable is property 8: the engine agrees with sort.SliceStable on every interval. The fixed
// case first makes sure the counting-sort path (32 pixels and up) is exercised as well as insertion sort.
func TestProp_OracleSliceStable(t *testing.T) {
	im := testutil.UniqueIDImage(64, 1)
	p := engine.DefaultParams()
	p.Mode = engine.ModeNone
	p.Key = engine.KeyRed
	p.Randomness = 0
	pl := planOf(t, im, p, nil)
	if len(pl.Intervals) != 1 || pl.Intervals[0].B-pl.Intervals[0].A < 32 {
		t.Fatalf("the fixed case has intervals %v, want one of 32+ pixels", pl.Intervals)
	}
	checkOracle(t, pl)

	rapid.Check(t, func(t *rapid.T) {
		im := testutil.ImageGen(40, 40).Draw(t, "image")
		p := testutil.ParamsGenNoCA().Draw(t, "params")
		pl, err := engine.NewPlan(im, p, nil)
		if err != nil {
			t.Fatalf("NewPlan: %v", err)
		}
		checkOracle(t, pl)
	})
}

// TestProp_RegionBoundaries is property 7: no interval spans two cells, before or after sorting.
func TestProp_RegionBoundaries(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		im := testutil.ImageGen(30, 30).Draw(t, "image")
		regions := testutil.RegionsGen(im.W, im.H).Draw(t, "regions")
		p := testutil.ParamsGenNoCA().Draw(t, "params")
		pl, err := engine.NewPlan(im, p, &engine.Options{Regions: regions})
		if err != nil {
			t.Fatalf("NewPlan: %v", err)
		}
		pl.Sort()
		for _, iv := range pl.Intervals {
			cell := regions.Labels[pl.Lines.P[iv.A]]
			for i := iv.A; i < iv.B; i++ {
				if regions.Labels[pl.Lines.P[i]] != cell {
					t.Fatalf("interval %v crosses cells", iv)
				}
			}
		}
	})
}

// checkOracle compares each interval's output with sort.SliceStable over its (key, pixel) pairs.
func checkOracle(t testHelper, pl *engine.Plan) {
	t.Helper()
	out := pl.Sort()
	for n, iv := range pl.Intervals {
		type item struct {
			key uint8
			px  uint32
		}
		items := make([]item, 0, iv.B-iv.A)
		for i := iv.A; i < iv.B; i++ {
			pos := pl.Lines.P[i]
			items = append(items, item{key: pl.Keys[pos], px: pl.Orig[pos]})
		}
		sort.SliceStable(items, func(i, j int) bool { return items[i].key < items[j].key })
		for j, want := range items {
			if got := out.Pix[pl.Lines.P[iv.A+int32(j)]]; got != want.px {
				t.Fatalf("interval %d (%v) offset %d: got %#x, oracle says %#x", n, iv, j, got, want.px)
			}
		}
	}
}

// classKey returns the key function that applies to the pixel at position pos: its class's key and direction.
func classKey(pl *engine.Plan, o *engine.Options, im *engine.Image, p engine.Params, pos int) engine.KeyFunc {
	if o.Regions == nil {
		return engine.KeyFor(p.Key, p.Reverse)
	}
	eff := p.With(o.Regions.Defs[o.Regions.ClassOf[o.Regions.Labels[pl.Lines.P[pos]]]])
	return engine.KeyFor(eff.Key, eff.Reverse)
}

// checkPermutation asserts the output is a rearrangement of the input.
func checkPermutation(t testHelper, in, out *engine.Image) {
	t.Helper()
	if len(in.Pix) != len(out.Pix) {
		t.Fatalf("output has %d pixels, input has %d", len(out.Pix), len(in.Pix))
	}
	a := append([]uint32(nil), in.Pix...)
	b := append([]uint32(nil), out.Pix...)
	sort.Slice(a, func(i, j int) bool { return a[i] < a[j] })
	sort.Slice(b, func(i, j int) bool { return b[i] < b[j] })
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("output is not a permutation of the input (first difference at %d)", i)
		}
	}
}
