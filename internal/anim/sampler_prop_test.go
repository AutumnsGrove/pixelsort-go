package anim_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/internal/anim"
	"pgregory.net/rapid"
)

// The frame list is what the preview and the export both walk. These are the rules every list obeys.
func TestProp_SamplerShape(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		total := rapid.IntRange(0, 5000).Draw(t, "total")
		frames := rapid.IntRange(2, anim.MaxFrames).Draw(t, "frames")
		ease := rapid.SampledFrom([]anim.Ease{anim.Linear, anim.EaseOut}).Draw(t, "ease")
		passes := anim.Sample(total, frames, ease)
		if len(passes) != frames {
			t.Fatalf("got %d passes, want %d", len(passes), frames)
		}
		if passes[0] != 0 || passes[len(passes)-1] != total {
			t.Fatalf("passes must start at 0 and end at %d: %v", total, passes)
		}
		for i := 1; i < len(passes); i++ {
			if passes[i] < passes[i-1] {
				t.Fatalf("passes go backwards at %d: %v", i, passes)
			}
		}
		if frames <= total+1 {
			for i := 1; i < len(passes); i++ {
				if passes[i] <= passes[i-1] {
					t.Fatalf("with %d frames over %d passes every frame must be a new pass, but %d repeats: %v", frames, total, i, passes)
				}
			}
		}
	})
}

// Ease-out is the same walk with time pushed forwards: every frame is at or past where linear would be.
func TestProp_EaseOutIsNeverBehindLinear(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		total := rapid.IntRange(1, 5000).Draw(t, "total")
		frames := rapid.IntRange(2, 240).Draw(t, "frames")
		linear := anim.Sample(total, frames, anim.Linear)
		out := anim.Sample(total, frames, anim.EaseOut)
		for i := range linear {
			if out[i] < linear[i] {
				t.Fatalf("frame %d: ease-out pass %d is behind linear %d", i, out[i], linear[i])
			}
		}
	})
}
