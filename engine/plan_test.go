package engine_test

import (
	"errors"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// planOf builds a plan from an image and a recipe, failing the test on any error.
func planOf(t *testing.T, im *engine.Image, p engine.Params, o *engine.Options) *engine.Plan {
	t.Helper()
	pl, err := engine.NewPlan(im, p, o)
	if err != nil {
		t.Fatalf("NewPlan: %v", err)
	}
	return pl
}

func TestPlanNoneMode(t *testing.T) {
	im := testutil.Gradient(4, 2, 0)
	p := engine.DefaultParams()
	p.Mode = engine.ModeNone
	p.Angle = 0
	p.Randomness = 0
	pl := planOf(t, im, p, nil)
	if pl.Stats.Lines != 2 || pl.Stats.Intervals != 2 {
		t.Fatalf("stats = %+v, want 2 lines and 2 intervals", pl.Stats)
	}
	want := []engine.Interval{{A: 0, B: 4}, {A: 4, B: 8}}
	if len(pl.Intervals) != len(want) {
		t.Fatalf("intervals = %v, want %v", pl.Intervals, want)
	}
	for i := range want {
		if pl.Intervals[i] != want[i] {
			t.Fatalf("intervals = %v, want %v", pl.Intervals, want)
		}
	}
	if pl.Stats.SortablePixels != 8 || pl.Stats.FrozenPixels != 0 {
		t.Errorf("stats = %+v, want 8 sortable and 0 frozen", pl.Stats)
	}
}

func TestPlanRandomnessBounds(t *testing.T) {
	im := testutil.Gradient(20, 5, 1)
	p := engine.DefaultParams()
	p.Mode = engine.ModeRandom
	p.Length = 250 // 5 px at this width
	p.Angle = 0
	p.Randomness = 100
	if pl := planOf(t, im, p, nil); len(pl.Intervals) != 0 {
		t.Fatalf("randomness 100 left %d intervals", len(pl.Intervals))
	}
	p.Randomness = 0
	pl := planOf(t, im, p, nil)
	if len(pl.Intervals) == 0 {
		t.Fatal("randomness 0 left nothing to sort")
	}
	// A random cut can leave a one-pixel tail at the end of a line, and segments under two pixels are not sorted,
	// so each line may lose exactly one pixel and no more.
	if want := 100 - pl.Stats.Lines; pl.Stats.SortablePixels < want {
		t.Errorf("sortable = %d, want at least %d", pl.Stats.SortablePixels, want)
	}
}

// TestPlanThresholdFreezes: red values [10 100 100 250 100] with the band [50,200] freeze positions 0 and 3, so the
// only run long enough to sort is [1,3). Position 4 is a run of one, and runs under two pixels are not sorted.
func TestPlanThresholdFreezes(t *testing.T) {
	im := &engine.Image{W: 5, H: 1, Pix: make([]uint32, 5)}
	for i, red := range []uint8{10, 100, 100, 250, 100} {
		im.Pix[i] = engine.Pack(red, 0, 0, 255)
	}
	p := engine.DefaultParams()
	p.Mode = engine.ModeThreshold
	p.ThresholdKey = engine.KeyRed
	p.Lo, p.Hi = 50, 200
	p.Randomness = 0
	pl := planOf(t, im, p, nil)
	want := []engine.Interval{{A: 1, B: 3}}
	if !equalIntervals(pl.Intervals, want) {
		t.Fatalf("intervals = %v, want %v", pl.Intervals, want)
	}
	if pl.Stats.FrozenPixels != 2 {
		t.Errorf("frozen = %d, want 2", pl.Stats.FrozenPixels)
	}
}

func TestPlanMaskFreezes(t *testing.T) {
	im := testutil.UniqueIDImage(6, 1)
	mask := make([]uint8, 6)
	mask[3] = 255
	p := engine.DefaultParams()
	p.Mode = engine.ModeNone
	p.Randomness = 0
	pl := planOf(t, im, p, &engine.Options{Mask: mask})
	want := []engine.Interval{{A: 0, B: 3}, {A: 4, B: 6}}
	if !equalIntervals(pl.Intervals, want) {
		t.Fatalf("intervals = %v, want %v", pl.Intervals, want)
	}
	if pl.Stats.FrozenPixels != 1 {
		t.Errorf("frozen = %d, want 1", pl.Stats.FrozenPixels)
	}
}

// TestPlanEdgesCutsAtFirstEdgePixel uses a 1x8 column whose luma is [0 0 100 100 100 100 0 0]. In a one-row image
// the laplacian reduces to 3*|2l(x) - l(x-1) - l(x+1)|, which is above 26 at x=1,2 (the rise) and x=5,6 (the fall)
// and zero elsewhere. Each two-pixel run is cut once, at its first pixel, so the segments are [0,1), [1,5), [5,8):
// the first is dropped for being one pixel long.
func TestPlanEdgesCutsAtFirstEdgePixel(t *testing.T) {
	luma := []uint8{0, 0, 100, 100, 100, 100, 0, 0}
	im := &engine.Image{W: 8, H: 1, Pix: make([]uint32, 8)}
	for i, v := range luma {
		im.Pix[i] = engine.Pack(v, v, v, 255)
	}
	p := engine.DefaultParams()
	p.Mode = engine.ModeEdges
	p.Edge = 26
	p.Randomness = 0
	pl := planOf(t, im, p, nil)
	want := []engine.Interval{{A: 1, B: 5}, {A: 5, B: 8}}
	if !equalIntervals(pl.Intervals, want) {
		t.Fatalf("intervals = %v, want %v", pl.Intervals, want)
	}
}

// TestPlanRandomMeanLength checks that `length` really is the mean interval length (PLAN.md 3.3 fixed Python, where
// the slider showed the maximum instead).
func TestPlanRandomMeanLength(t *testing.T) {
	im := testutil.Gradient(600, 40, 2)
	p := engine.DefaultParams()
	p.Mode = engine.ModeRandom
	p.Length = 50 // 30 px at width 600
	p.Randomness = 0
	p.Angle = 0
	pl := planOf(t, im, p, nil)
	if len(pl.Intervals) == 0 {
		t.Fatal("no intervals")
	}
	total := 0
	for _, iv := range pl.Intervals {
		total += int(iv.B - iv.A)
	}
	mean := float64(total) / float64(len(pl.Intervals))
	if mean < 30*0.85 || mean > 30*1.15 {
		t.Fatalf("mean interval length %.2f, want within 15%% of 30", mean)
	}
}

// TestPlanWaveModulatesWidth checks the wave mode really modulates (decision E7): the factor swings 1000 +- 700
// for the default amplitude, so with `length` at 30 px the widths spread from about 9 to about 51 px, plus the
// 900..1100 jitter.
//
// The mean interval length is deliberately not asserted to be `length`: the width is a function of the position
// along the line, so short segments are sampled more often than long ones and the average interval is the harmonic
// mean, roughly 21 px. That is what the spec's formula produces; `random` is the mode whose means match `length`.
func TestPlanWaveModulatesWidth(t *testing.T) {
	im := testutil.Gradient(600, 20, 4)
	p := engine.DefaultParams()
	p.Mode = engine.ModeWave
	p.Length = 50 // 30 px at width 600
	p.Randomness = 0
	p.Angle = 0
	pl := planOf(t, im, p, nil)
	lengths := make(map[int32]bool, len(pl.Intervals))
	sortable := 0
	minLen, maxLen := int32(1<<31-1), int32(0)
	for _, iv := range pl.Intervals {
		n := iv.B - iv.A
		lengths[n] = true
		sortable += int(n)
		minLen, maxLen = min(minLen, n), max(maxLen, n)
	}
	if len(lengths) < 5 {
		t.Fatalf("wave produced only %d distinct lengths", len(lengths))
	}
	if minLen > 10 || maxLen < 45 {
		t.Fatalf("wave widths span %d..%d, want about 8..56", minLen, maxLen)
	}
	// Every pixel is sorted: the segments tile the line, and only a one-pixel tail may be dropped.
	if want := 20*600 - pl.Stats.Lines; sortable < want {
		t.Fatalf("sortable = %d, want at least %d", sortable, want)
	}
}

func TestPlanDeterministic(t *testing.T) {
	im := testutil.Gradient(40, 12, 3)
	p := engine.DefaultParams()
	p.Mode = engine.ModeRandom
	p.Angle = 33
	a := planOf(t, im, p, nil)
	b := planOf(t, im, p, nil)
	if !equalIntervals(a.Intervals, b.Intervals) {
		t.Fatal("two plans from the same recipe differ")
	}
	p.Seed++
	c := planOf(t, im, p, nil)
	if equalIntervals(a.Intervals, c.Intervals) {
		t.Fatal("changing the seed did not change the intervals")
	}
}

// TestPlanIndependentOfOtherLines checks the per-line RNG stream: making the image taller must not re-roll the
// first line's intervals.
func TestPlanIndependentOfOtherLines(t *testing.T) {
	rows := func(h int) *engine.Image {
		im := &engine.Image{W: 40, H: h, Pix: make([]uint32, 40*h)}
		for y := 0; y < h; y++ {
			for x := 0; x < 40; x++ {
				im.Pix[y*40+x] = engine.Pack(uint8(x*6), uint8(255-x*6), 30, 255)
			}
		}
		return im
	}
	p := engine.DefaultParams()
	p.Mode = engine.ModeRandom
	p.Length = 200
	p.Angle = 0
	p.Randomness = 0
	short := planOf(t, rows(10), p, nil)
	tall := planOf(t, rows(20), p, nil)
	if short.Intervals[0] != tall.Intervals[0] {
		t.Fatalf("first interval changed with the image height: %v vs %v", short.Intervals[0], tall.Intervals[0])
	}
}

func TestPlanRejectsBadOptions(t *testing.T) {
	im := testutil.Gradient(4, 4, 0)
	p := engine.DefaultParams()
	if _, err := engine.NewPlan(im, p, &engine.Options{Mask: make([]uint8, 3)}); !errors.Is(err, engine.ErrBadData) {
		t.Errorf("short mask: error = %v, want ErrBadData", err)
	}
	if _, err := engine.NewPlan(im, p, &engine.Options{Soft: make([]uint8, 3)}); !errors.Is(err, engine.ErrBadData) {
		t.Errorf("short soft mask: error = %v, want ErrBadData", err)
	}
	bad := &engine.Regions{Labels: make([]uint16, 3), ClassOf: []uint8{0}, Defs: []engine.ClassDef{{}}}
	if _, err := engine.NewPlan(im, p, &engine.Options{Regions: bad}); !errors.Is(err, engine.ErrBadRegions) {
		t.Errorf("bad regions: error = %v, want ErrBadRegions", err)
	}
}

// TestPlanRejectsInconsistentImage: Image has exported fields, so a caller can build one whose Pix does not match
// its size. That must be an error, not a panic: in WebAssembly a panic ends the whole Go runtime.
func TestPlanRejectsInconsistentImage(t *testing.T) {
	tests := []struct {
		name string
		im   *engine.Image
		want error
	}{
		{"nil pixels", &engine.Image{W: 2, H: 2}, engine.ErrBadData},
		{"too few pixels", &engine.Image{W: 2, H: 2, Pix: make([]uint32, 3)}, engine.ErrBadData},
		{"too many pixels", &engine.Image{W: 2, H: 2, Pix: make([]uint32, 5)}, engine.ErrBadData},
		{"zero width", &engine.Image{W: 0, H: 2}, engine.ErrBadSize},
		{"negative height", &engine.Image{W: 2, H: -1}, engine.ErrBadSize},
		{"larger than MaxPixels", &engine.Image{W: 1 << 20, H: 1 << 20}, engine.ErrBadSize},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("NewPlan panicked: %v", r)
				}
			}()
			if _, err := engine.NewPlan(tc.im, engine.DefaultParams(), nil); !errors.Is(err, tc.want) {
				t.Fatalf("error = %v, want %v", err, tc.want)
			}
		})
	}
}

// TestPlanRegionOverrides: the left half is a frozen class, the right half sorts at 90 degrees, so no interval may
// touch the left half and every interval in the right half must stay in one column.
func TestPlanRegionOverrides(t *testing.T) {
	const w, h = 8, 4
	labels := make([]uint16, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if x < w/2 {
				labels[y*w+x] = 1
			} else {
				labels[y*w+x] = 2
			}
		}
	}
	steep := 90
	regions := &engine.Regions{
		Labels:  labels,
		ClassOf: []uint8{0, 1, 2},
		Defs:    []engine.ClassDef{{}, {Frozen: true}, {Angle: &steep}},
	}
	im := testutil.Gradient(w, h, 1)
	p := engine.DefaultParams()
	p.Mode = engine.ModeNone
	p.Randomness = 0
	p.Angle = 0
	pl := planOf(t, im, p, &engine.Options{Regions: regions})
	if len(pl.Intervals) == 0 {
		t.Fatal("nothing to sort")
	}
	for _, iv := range pl.Intervals {
		first := pl.Lines.P[iv.A]
		xs := make(map[int]bool)
		for i := iv.A; i < iv.B; i++ {
			pos := pl.Lines.P[i]
			if regions.Labels[pos] == 1 {
				t.Fatalf("interval %v touches the frozen class", iv)
			}
			xs[int(pos)%w] = true
		}
		if regions.Labels[first] == 2 && len(xs) != 1 {
			t.Fatalf("interval %v spans columns %v, but class 2 sorts at 90 degrees", iv, xs)
		}
	}
}

// equalIntervals is slices.Equal for intervals, spelled out so failures read well.
func equalIntervals(a, b []engine.Interval) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
