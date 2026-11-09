package engine_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

func patternRecipe(mode engine.IntervalMode) engine.Params {
	p := engine.DefaultParams()
	p.Mode, p.Randomness, p.Key = mode, 0, engine.KeyRed
	p.Pattern, p.PatternVariant = "truchet", "arc"
	p.PatternCell, p.PatternThickness, p.PatternDetail = 60, 8, 5
	p.Seed = 3
	return p
}

// risingCuts is cutRising as the test expects it: a cut before every pixel where the mask turns on.
func risingCuts(line []int32, r0, r1 int, mask []uint8) []engine.Interval {
	var out []engine.Interval
	c := r0
	for u := r0 + 1; u < r1; u++ {
		if mask[line[u]] != 0 && mask[line[u-1]] == 0 {
			out = append(out, engine.Interval{A: int32(c), B: int32(u)})
			c = u
		}
	}
	return append(out, engine.Interval{A: int32(c), B: int32(r1)})
}

func TestPlanPatternCutsOnRisingEdges(t *testing.T) {
	// One line, so the preview is exactly the mask the plan reads. The plan's intervals must be the runs that start
	// where the pattern turns on, with no interval shorter than two pixels.
	p := patternRecipe(engine.ModePattern)
	m, err := engine.PatternPreview(120, 1, p)
	if err != nil {
		t.Fatal(err)
	}
	pl := mustPlan(t, testutil.Gradient(120, 1, 1), p, nil)
	var want []engine.Interval
	for _, iv := range risingCuts(pl.Lines.P, 0, 120, m) {
		if iv.B-iv.A >= 2 {
			want = append(want, iv)
		}
	}
	if !slices.Equal(pl.Intervals, want) {
		t.Fatalf("intervals %v, want %v", pl.Intervals, want)
	}
	if len(pl.Intervals) == 0 {
		t.Fatal("the pattern produced no intervals")
	}
}

func TestPlanPatternEdgesCutAtThePatternEdges(t *testing.T) {
	p := patternRecipe(engine.ModePatternEdges)
	p.Edge = 0
	pl := mustPlan(t, testutil.Gradient(120, 40, 1), p, nil)
	if len(pl.Intervals) < 2 {
		t.Fatalf("intervals %v: expected cuts at the pattern edges", pl.Intervals)
	}
	for _, iv := range pl.Intervals {
		if iv.B-iv.A < 2 {
			t.Fatalf("short interval %v", iv)
		}
	}
}

func TestPlanPatternOverlayFreezesThePattern(t *testing.T) {
	p := patternRecipe(engine.ModeNone)
	p.PatternOverlay = true
	im := testutil.Gradient(97, 61, 2)
	m, err := engine.PatternPreview(97, 61, p)
	if err != nil {
		t.Fatal(err)
	}
	frozen := 0
	for _, v := range m {
		if v != 0 {
			frozen++
		}
	}
	pl := mustPlan(t, im, p, nil)
	if pl.Stats.FrozenPixels != frozen {
		t.Fatalf("frozen %d, want the pattern's %d", pl.Stats.FrozenPixels, frozen)
	}
	for _, iv := range pl.Intervals {
		for i := iv.A; i < iv.B; i++ {
			if m[pl.Lines.P[i]] != 0 {
				t.Fatalf("a frozen pattern pixel is inside interval %v", iv)
			}
		}
	}
	// With the overlay off, the same pattern freezes nothing.
	p.PatternOverlay = false
	plain := mustPlan(t, im, p, nil)
	if plain.Stats.FrozenPixels != 0 {
		t.Fatalf("without the overlay %d pixels are frozen", plain.Stats.FrozenPixels)
	}
}

func TestPlanPatternOverlayComposesWithAProtectMask(t *testing.T) {
	p := patternRecipe(engine.ModeNone)
	p.PatternOverlay = true
	im := testutil.Gradient(40, 30, 2)
	m, _ := engine.PatternPreview(40, 30, p)
	protect := make([]uint8, 40*30)
	protect[0], protect[1] = 1, 1
	pl := mustPlan(t, im, p, &engine.Options{Mask: protect})
	frozen := 0
	for _, v := range m {
		if v != 0 {
			frozen++
		}
	}
	// The two protect pixels may already be pattern pixels; the union is what matters.
	want := frozen
	if m[0] == 0 {
		want++
	}
	if m[1] == 0 {
		want++
	}
	if pl.Stats.FrozenPixels != want {
		t.Fatalf("frozen %d, want the union %d", pl.Stats.FrozenPixels, want)
	}
}

func TestPlanPatternIsDeterministic(t *testing.T) {
	for _, mode := range []engine.IntervalMode{engine.ModePattern, engine.ModePatternEdges} {
		p := patternRecipe(mode)
		p.Angle = 33
		a := mustPlan(t, testutil.Gradient(60, 40, 2), p, nil)
		b := mustPlan(t, testutil.Gradient(60, 40, 2), p, nil)
		if !slices.Equal(a.Intervals, b.Intervals) {
			t.Fatalf("%s: two plans of the same recipe differ", mode)
		}
	}
}

func TestPatternLineSpaceTurnsWithTheAngle(t *testing.T) {
	intervals := func(angle int, space string) []engine.Interval {
		p := patternRecipe(engine.ModePattern)
		p.Angle, p.CASpace = angle, space
		return mustPlan(t, testutil.Gradient(64, 64, 2), p, nil).Intervals
	}
	if !slices.Equal(intervals(0, engine.CASpaceImage), intervals(0, engine.CASpaceLine)) {
		t.Fatal("line space and image space differ at angle 0")
	}
	if slices.Equal(intervals(37, engine.CASpaceImage), intervals(37, engine.CASpaceLine)) {
		t.Fatal("line space and image space look the same at 37 degrees")
	}
}

func TestPatternPreviewIsBinaryAndDeterministic(t *testing.T) {
	for _, p := range []engine.Params{
		patternRecipe(engine.ModePattern),
		func() engine.Params {
			p := patternRecipe(engine.ModePattern)
			p.CASpace = engine.CASpaceLine
			p.Angle = 37
			return p
		}(),
		func() engine.Params {
			p := patternRecipe(engine.ModePattern)
			p.Pattern, p.PatternVariant = "radial", "spiral"
			return p
		}(),
	} {
		a, err := engine.PatternPreview(320, 160, p)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := engine.PatternPreview(320, 160, p)
		if !slices.Equal(a, b) {
			t.Fatal("not deterministic")
		}
		for i, v := range a {
			if v > 1 {
				t.Fatalf("byte %d is %d", i, v)
			}
		}
	}
}

func TestPatternPreviewRefusesBadInput(t *testing.T) {
	p := patternRecipe(engine.ModePattern)
	for _, size := range [][2]int{{0, 10}, {10, 0}, {engine.MaxPatternPreview + 1, 10}, {10, engine.MaxPatternPreview + 1}} {
		if _, err := engine.PatternPreview(size[0], size[1], p); err == nil {
			t.Errorf("%dx%d should be refused", size[0], size[1])
		}
	}
	p.Pattern = ""
	if _, err := engine.PatternPreview(10, 10, p); err == nil {
		t.Error("a recipe without a pattern should be refused")
	}
}

func TestPatternModesRejectAMissingPattern(t *testing.T) {
	for _, mode := range []engine.IntervalMode{engine.ModePattern, engine.ModePatternEdges} {
		p := patternRecipe(mode)
		p.Pattern = ""
		if err := p.Validate(); err == nil {
			t.Errorf("%s without a pattern should be refused", mode)
		}
	}
}
