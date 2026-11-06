package engine

import "fmt"

// MaxCAPreview bounds the size of a preview canvas on either side, so a caller cannot ask for a huge allocation.
const MaxCAPreview = 1024

// CAPreview draws what a cellular rule makes of a recipe on a small w x h canvas, as a 0/1 mask per pixel position:
// the same grid, boundary and seed the sort uses, laid out the same way (square cells over the picture in image space,
// along the sort lines at the recipe's angle in line space), with the cell size taken as the same fraction of the
// canvas width that the recipe means for the picture. It is built from the sort's own mask code, never a second copy,
// so the panel's picture cannot drift from the real mask. The interval mode is ignored: the panel shows the rule before
// anyone switches to a cellular mode.
//
// It shows the rule's texture, not the exact mask of a given photo: a picture of another size has a grid of another size,
// and a grid's first row is drawn from the seed for that width.
func CAPreview(w, h int, p Params) ([]uint8, error) {
	if w < 1 || h < 1 || w > MaxCAPreview || h > MaxCAPreview {
		return nil, fmt.Errorf("engine: ca preview size %dx%d is outside 1..%d", w, h, MaxCAPreview)
	}
	if err := p.Validate(); err != nil {
		return nil, fmt.Errorf("engine: ca preview: %w", err)
	}
	pl := &Plan{W: w, H: h, Lines: Partition(w, h, p.Angle)}
	return newCACache(pl, p.Seed, nil).mask(p), nil
}
