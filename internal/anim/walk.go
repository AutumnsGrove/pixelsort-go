package anim

import (
	"fmt"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// ckptBudget bounds the memory the walker's checkpoints may use. A checkpoint costs about 5 bytes a pixel (the pixels
// and their keys), the same estimate the engine session uses for scrubbing (engine/api/session.go).
const ckptBudget = 96 << 20

// Walk calls fn with the image at each pass in passes, in order, starting from a fresh stepper. Passes may repeat, and
// they may go backwards (an Infinity loop's return leg): the walker keeps a few checkpoints, so a rewind replays from
// the nearest one instead of from the original, and a whole animation still costs about one sort plus one replay per
// leg. The image passed to fn is only valid until fn returns: copy it if you keep it.
func Walk(pl *engine.Plan, passes []int, fn func(frame, pass int, im *engine.Image) error) error {
	if pl == nil {
		return fmt.Errorf("anim: walk needs a plan")
	}
	w := newWalker(pl, passes)
	for i, target := range passes {
		if target < 0 {
			return fmt.Errorf("anim: frame %d asks for pass %d", i, target)
		}
		w.at(target)
		if err := fn(i, target, w.s.Image()); err != nil {
			return err
		}
	}
	return nil
}

// walker is the smallest thing that can step forward and rewind: a live stepper plus evenly spread checkpoints of it.
// It is the read-only cousin of the engine session's scrub cache, and only ever cloned, never handed out.
type walker struct {
	pl    *engine.Plan
	s     *engine.Stepper
	ckpts []*engine.Stepper
	// stride is how often a checkpoint is taken. It is chosen before the walk from the highest pass asked for, so a
	// checkpoint sits near every part of the sort.
	stride int
}

func newWalker(pl *engine.Plan, passes []int) *walker {
	highest := 0
	for _, p := range passes {
		highest = max(highest, p)
	}
	// At least two checkpoints, at most sixteen, whichever the budget allows for this picture.
	w, h := pl.W, pl.H
	count := min(16, max(2, ckptBudget/max(1, w*h*5)))
	stride := max(1, (highest+count-1)/count)
	return &walker{pl: pl, s: pl.NewStepper(), stride: stride}
}

// at moves the stepper to the state after pass target, stepping forward or rewinding to the nearest checkpoint.
func (w *walker) at(target int) {
	if target < w.s.Pass() {
		if best := w.checkpointAt(target); best != nil {
			w.s = best.Clone()
		} else {
			w.s = w.pl.NewStepper()
		}
	}
	for !w.s.Done() && w.s.Pass() < target {
		w.s.Step()
		w.noteCheckpoint()
	}
}

// checkpointAt is the latest checkpoint at or before pass, or nil.
func (w *walker) checkpointAt(pass int) *engine.Stepper {
	for i := len(w.ckpts) - 1; i >= 0; i-- {
		if w.ckpts[i].Pass() <= pass {
			return w.ckpts[i]
		}
	}
	return nil
}

// noteCheckpoint keeps a clone of the stepper on every multiple of the stride.
func (w *walker) noteCheckpoint() {
	p := w.s.Pass()
	if p == 0 || p%w.stride != 0 || len(w.ckpts) >= 16 {
		return
	}
	if len(w.ckpts) > 0 && w.ckpts[len(w.ckpts)-1].Pass() >= p {
		return
	}
	w.ckpts = append(w.ckpts, w.s.Clone())
}
