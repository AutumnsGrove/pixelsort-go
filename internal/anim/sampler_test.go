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
	p := anim.NewSequence(10, 1000, 10, 250, anim.Linear)
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
	p := anim.NewSequence(10, 1000, 10, 0, anim.Ease("nonsense"))
	if !slices.Equal(p.Passes, anim.Sample(10, 10, anim.Linear)) {
		t.Fatalf("unknown easing did not fall back to linear: %v", p.Passes)
	}
}
