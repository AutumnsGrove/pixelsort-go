package anim_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/internal/anim"
)

func TestFrameCount(t *testing.T) {
	cases := []struct {
		name       string
		durationMS int
		fps        int
		want       int
	}{
		{"five seconds at thirty", 5000, 30, 150},
		{"two seconds at twenty four", 2000, 24, 48},
		{"rounds up past half a frame", 1000, 25, 25},
		{"never fewer than two frames", 10, 1, 2},
		{"caps a runaway duration", 10_000_000, 60, anim.MaxFrames},
		{"clamps a bad duration", -5, 30, 2},
		{"clamps a bad fps", 5000, 0, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := anim.FrameCount(tc.durationMS, tc.fps); got != tc.want {
				t.Fatalf("FrameCount(%d, %d) = %d, want %d", tc.durationMS, tc.fps, got, tc.want)
			}
		})
	}
}

func TestSampleLinearWalksEveryPass(t *testing.T) {
	got := anim.Sample(4, 5, anim.Linear)
	want := []int{0, 1, 2, 3, 4}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSampleLinearSpreadsThePasses(t *testing.T) {
	// Ten passes over four frames: 0, 3.33, 6.67, 10 rounded.
	got := anim.Sample(10, 4, anim.Linear)
	want := []int{0, 3, 7, 10}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSampleEaseOutFrontLoads(t *testing.T) {
	// Halfway through the time reaches three quarters of the passes: 1 - (1 - 1/2)^2 = 3/4.
	got := anim.Sample(100, 3, anim.EaseOut)
	if got[1] != 75 {
		t.Fatalf("ease-out midpoint = %d, want 75 (got %v)", got[1], got)
	}
}

func TestSampleRepeatsWhenThereAreMoreFramesThanPasses(t *testing.T) {
	// A merge sort may have only a dozen passes; a five second export still gets its frames, spread evenly.
	got := anim.Sample(2, 7, anim.EaseOut)
	want := []int{0, 0, 1, 1, 1, 2, 2}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSampleNoPassesIsAllZero(t *testing.T) {
	if got := anim.Sample(0, 4, anim.Linear); !slices.Equal(got, []int{0, 0, 0, 0}) {
		t.Fatalf("got %v", got)
	}
}

func TestNewPlanDelaysAndHold(t *testing.T) {
	p := anim.NewSequence(10, 1000, 10, 250, anim.Linear, anim.Once, true)
	if len(p.DelaysMS) != 10 || len(p.Passes) != 10 {
		t.Fatalf("got %d passes and %d delays, want 10 each", len(p.Passes), len(p.DelaysMS))
	}
	if p.DelaysMS[0] != 100 {
		t.Fatalf("frame delay = %d, want 100", p.DelaysMS[0])
	}
	if p.DelaysMS[9] != 350 {
		t.Fatalf("last delay = %d, want 100 + 250", p.DelaysMS[9])
	}
}

func TestNewPlanClampsEase(t *testing.T) {
	p := anim.NewSequence(10, 1000, 10, 0, anim.Ease("nonsense"), anim.Once, true)
	if !slices.Equal(p.Passes, anim.Sample(10, 10, anim.Linear)) {
		t.Fatalf("unknown easing did not fall back to linear: %v", p.Passes)
	}
}

// forwardSequence is the studio's helper in the TypeScript tests: ten frames a second, so a frame lasts 100 ms whatever
// the frame count works out to. The two samplers must agree on every one of these cases.
func forwardSequence(total, frames int) anim.Sequence {
	return anim.NewSequence(total, frames*100, 10, 100, anim.Linear, anim.Once, true)
}

func TestRoundTripWalksThePassesBackToTheFirst(t *testing.T) {
	loop := anim.RoundTrip(forwardSequence(4, 5), 0, true) // passes 0..4 forward
	want := []int{0, 1, 2, 3, 4, 3, 2, 1}
	if !slices.Equal(loop.Passes, want) {
		t.Fatalf("got %v, want %v", loop.Passes, want)
	}
	if len(loop.DelaysMS) != len(loop.Passes) {
		t.Fatalf("%d delays for %d frames", len(loop.DelaysMS), len(loop.Passes))
	}
}

func TestRoundTripDropsBothTurnaroundFrames(t *testing.T) {
	loop := anim.RoundTrip(forwardSequence(4, 5), 0, true)
	var originals, finals int
	for i, p := range loop.Passes {
		switch p {
		case 0:
			originals++
		case 4:
			finals++
		}
		if i > 0 && p == loop.Passes[i-1] {
			t.Fatalf("frame %d repeats pass %d: %v", i, p, loop.Passes)
		}
	}
	if originals != 1 || finals != 1 {
		t.Fatalf("the original is shown %d times and the finished picture %d, want once each", originals, finals)
	}
}

func TestRoundTripDropsRepeatedEndpointsToo(t *testing.T) {
	// A three-pass sort over seven frames repeats every pass; the loop must not show four of one at the turnaround.
	fwd := forwardSequence(2, 7)
	if want := []int{0, 0, 1, 1, 1, 2, 2}; !slices.Equal(fwd.Passes, want) {
		t.Fatalf("forward leg = %v, want %v", fwd.Passes, want)
	}
	want := []int{0, 0, 1, 1, 1, 2, 2, 1, 1, 1}
	if got := anim.RoundTrip(fwd, 0, true).Passes; !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestRoundTripHoldsAtBothEnds(t *testing.T) {
	loop := anim.RoundTrip(forwardSequence(4, 5), 100, true)
	if loop.DelaysMS[0] != 200 {
		t.Fatalf("the original holds for %d ms, want 200", loop.DelaysMS[0])
	}
	if loop.DelaysMS[4] != 200 {
		t.Fatalf("the finished picture holds for %d ms, want 200", loop.DelaysMS[4])
	}
	if last := loop.DelaysMS[len(loop.DelaysMS)-1]; last != 100 {
		t.Fatalf("the last frame holds for %d ms, want one frame: it is on its way back", last)
	}
}

func TestRoundTripClosesTheLoopWhenItWillNotRepeat(t *testing.T) {
	open := anim.RoundTrip(forwardSequence(4, 5), 100, true)
	closed := anim.RoundTrip(forwardSequence(4, 5), 100, false)
	if closed.Passes[len(closed.Passes)-1] != 0 {
		t.Fatalf("the last pass is %d, want the original", closed.Passes[len(closed.Passes)-1])
	}
	if last := closed.DelaysMS[len(closed.DelaysMS)-1]; last != 200 {
		t.Fatalf("the closing frame holds for %d ms, want 200", last)
	}
	if len(closed.Passes) != len(open.Passes)+1 {
		t.Fatalf("closing added %d frames, want 1", len(closed.Passes)-len(open.Passes))
	}
}

func TestRoundTripIsItsOwnMirror(t *testing.T) {
	// The premise: enough passes for every frame to be a new one, so nothing but the two endpoints is dropped.
	for _, c := range [][2]int{{1, 2}, {2, 3}, {7, 8}, {40, 9}, {300, 2}, {300, 50}} {
		fwd := forwardSequence(c[0], c[1])
		for i, p := range fwd.Passes {
			if i > 0 && p <= fwd.Passes[i-1] {
				t.Fatalf("%v: the forward leg repeats (it is not a strict case)", c)
			}
		}
		loop := anim.RoundTrip(fwd, 0, true)
		if loop.Passes[0] != 0 {
			t.Fatalf("%v: the loop starts at pass %d, want 0", c, loop.Passes[0])
		}
		if got := slices.Max(loop.Passes); got != c[0] {
			t.Fatalf("%v: the highest pass is %d, want %d", c, got, c[0])
		}
		n := len(fwd.Passes)
		for k := 1; k < n-1; k++ {
			if got := loop.Passes[len(loop.Passes)-k]; got != fwd.Passes[k] {
				t.Fatalf("%v: frame -%d is pass %d, want %d (the legs must mirror)", c, k, got, fwd.Passes[k])
			}
		}
	}
}

func TestNewSequenceInfinitySplitsTheDuration(t *testing.T) {
	once := anim.NewSequence(500, 4000, 24, 0, anim.Linear, anim.Once, true)
	loop := anim.NewSequence(500, 4000, 24, 0, anim.Linear, anim.Infinity, true)
	if len(once.Passes) != 96 {
		t.Fatalf("once has %d frames, want 96", len(once.Passes))
	}
	// The loop lasts as long as the setting says, so it has about as many frames as the once export.
	if len(loop.Passes) != 94 {
		t.Fatalf("the loop has %d frames, want 94", len(loop.Passes))
	}
}

func TestNewSequenceInfinityWithNothingToSort(t *testing.T) {
	loop := anim.NewSequence(0, 1000, 10, 100, anim.Linear, anim.Infinity, true)
	if len(loop.Passes) == 0 {
		t.Fatal("no frames")
	}
	for _, p := range loop.Passes {
		if p != 0 {
			t.Fatalf("a still picture asked for pass %d: %v", p, loop.Passes)
		}
	}
}
