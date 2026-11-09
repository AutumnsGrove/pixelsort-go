package anim

import (
	"fmt"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// Walk calls fn with the image at each pass in passes, in order, starting from a fresh stepper. Passes may repeat;
// the stepper only moves forward, so a whole animation costs one sort. The image passed to fn is only valid until fn
// returns: copy it if you keep it.
func Walk(pl *engine.Plan, passes []int, fn func(frame, pass int, im *engine.Image) error) error {
	if pl == nil {
		return fmt.Errorf("anim: walk needs a plan")
	}
	s := pl.NewStepper()
	for i, target := range passes {
		if target < 0 {
			return fmt.Errorf("anim: frame %d asks for pass %d", i, target)
		}
		for !s.Done() && s.Pass() < target {
			s.Step()
		}
		if err := fn(i, target, s.Image()); err != nil {
			return err
		}
	}
	return nil
}
