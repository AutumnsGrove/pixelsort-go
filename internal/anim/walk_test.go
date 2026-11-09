package anim_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/anim"
)

// rowPlan is a 1-row picture of distinct reds, sorted by red with a plain odd-even sort: a sort long enough to have
// several passes, which is all Walk's rewind needs to be shown working.
func rowPlan(t *testing.T, pixels int) *engine.Plan {
	t.Helper()
	rgba := make([]byte, 4*pixels)
	// A fixed shuffle: a small LCG, so the picture is noisy but every run is the same one.
	state := uint32(12345)
	reds := make([]uint8, pixels)
	for i := range reds {
		state = state*1664525 + 1013904223
		reds[i] = uint8(state >> 24)
	}
	for i, r := range reds {
		rgba[4*i], rgba[4*i+3] = r, 255
	}
	im, err := engine.FromRGBA(pixels, 1, rgba)
	if err != nil {
		t.Fatal(err)
	}
	p, err := engine.ParseParams([]byte(`{"mode":"none","key":"red","algo":"oddeven","randomness":0,"length":1000}`))
	if err != nil {
		t.Fatal(err)
	}
	pl, err := engine.NewPlan(im, p, nil)
	if err != nil {
		t.Fatal(err)
	}
	return pl
}

// walkPasses records the pixels at each pass, walked forwards.
func walkPasses(t *testing.T, pl *engine.Plan, passes []int) map[int][]uint32 {
	t.Helper()
	seen := make(map[int][]uint32, len(passes))
	if err := anim.Walk(pl, passes, func(_, pass int, im *engine.Image) error {
		seen[pass] = slices.Clone(im.Pix)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return seen
}

func TestWalkRewindsToTheSameFrames(t *testing.T) {
	pl := rowPlan(t, 64)
	total := pl.MaxPasses()
	if total < 8 {
		t.Fatalf("only %d passes: too short to show a rewind", total)
	}
	forward := make([]int, total+1)
	for i := range forward {
		forward[i] = i
	}
	up := walkPasses(t, pl, forward)

	back := make([]int, total+1)
	for i := range back {
		back[i] = total - i
	}
	if err := anim.Walk(pl, back, func(_, pass int, im *engine.Image) error {
		if want := up[pass]; !slices.Equal(im.Pix, want) {
			t.Errorf("rewinding to pass %d did not give the frame the forward walk did", pass)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestWalkRewindSpansTheWholeSort(t *testing.T) {
	// A round trip is one up leg then one down leg: the frames in between must still be right when the checkpoints,
	// not the original, are the nearest state to rewind to.
	pl := rowPlan(t, 64)
	seq := anim.NewSequence(pl.MaxPasses(), 2000, 24, 0, anim.Linear, anim.Infinity, true)
	up := walkPasses(t, pl, seq.Passes)
	first, last := seq.Passes[0], seq.Passes[len(seq.Passes)-1]
	if first != 0 {
		t.Fatalf("the loop starts at pass %d, want the original", first)
	}
	if last >= pl.MaxPasses() {
		t.Fatalf("the loop ends on the finished picture")
	}
	if err := anim.Walk(pl, seq.Passes, func(frame, pass int, im *engine.Image) error {
		if want := up[pass]; !slices.Equal(im.Pix, want) {
			t.Errorf("frame %d (pass %d) does not match the forward walk", frame, pass)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestWalkAtPassZeroIsTheOriginalPicture(t *testing.T) {
	pl := rowPlan(t, 32)
	var got []uint32
	if err := anim.Walk(pl, []int{pl.MaxPasses(), 0}, func(_, _ int, im *engine.Image) error {
		got = slices.Clone(im.Pix)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got, pl.Orig) {
		t.Fatal("returning to pass 0 should give the original pixels back")
	}
}
