package engine

// PatternMaskForTest exposes the plan's own pattern mask so a property can check the overlay freeze rule against the
// same combined line partition the plan uses. A stateless preview cannot know a region map, because each class may
// walk its lines at its own angle.
func (pl *Plan) PatternMaskForTest(p Params) []uint8 { return pl.pattern.mask(p) }
