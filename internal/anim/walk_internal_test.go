package anim

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// sortablePlan is a shuffled 8-pixel row sorted by red, so a step actually moves something and the walker's
// checkpoint bookkeeping runs.
func sortablePlan(t *testing.T) *engine.Plan {
	t.Helper()
	reds := []byte{70, 10, 90, 30, 50, 20, 80, 40}
	rgba := make([]byte, 4*len(reds))
	for i, r := range reds {
		rgba[4*i], rgba[4*i+3] = r, 255
	}
	im, err := engine.FromRGBA(len(reds), 1, rgba)
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

// A one-way export must not pay for checkpoints it can never use: they cost about 5 bytes a pixel each.
func TestWalkerKeepsNoCheckpointsGoingForward(t *testing.T) {
	pl := sortablePlan(t)
	w := newWalker(pl, []int{0, 1, 2})
	if w.stride != 0 {
		t.Fatalf("stride = %d, want none: this walk never rewinds", w.stride)
	}
	w.at(2)
	if len(w.ckpts) != 0 {
		t.Fatalf("kept %d checkpoints on a forward-only walk", len(w.ckpts))
	}
}

func TestWalkerKeepsCheckpointsWhenItRewinds(t *testing.T) {
	pl := sortablePlan(t)
	w := newWalker(pl, []int{0, 4, 2, 0})
	if w.stride == 0 {
		t.Fatal("a walk that rewinds needs checkpoints")
	}
	w.at(4)
	if len(w.ckpts) == 0 {
		t.Fatal("no checkpoints were taken on the way up")
	}
	// Rewinding lands on a clone of a checkpoint, not in the middle of the live stepper's own history.
	before := w.s
	w.at(2)
	if w.s == before {
		t.Fatal("the rewind kept the same stepper instead of cloning a checkpoint")
	}
	if len(w.ckpts) > 16 {
		t.Fatalf("%d checkpoints: more than the budget allows", len(w.ckpts))
	}
}
