package engine

import (
	"cmp"
	"errors"
	"fmt"
	"slices"
)

// Regions is a region map (decision E10, PLAN.md 3.4): every pixel belongs to a cell, every cell to a class, and
// every class may override the recipe or freeze. Intervals never cross a cell boundary, so a class's settings are
// unambiguous for the whole run.
type Regions struct {
	Labels  []uint16   // len W*H: cell id per pixel; 0 = between shapes
	ClassOf []uint8    // indexed by cell id: the class of that cell; cell 0 is class 0
	Defs    []ClassDef // indexed by class id
}

// ErrBadRegions means a region map does not match its image or names a cell or class that does not exist.
var ErrBadRegions = errors.New("engine: invalid regions")

// Validate checks the map against an image size. A nil map is valid: it means "the whole image is one region".
func (r *Regions) Validate(w, h int) error {
	if r == nil {
		return nil
	}
	if len(r.Labels) != w*h {
		return fmt.Errorf("engine: %d region labels for a %dx%d image: %w", len(r.Labels), w, h, ErrBadRegions)
	}
	if len(r.ClassOf) == 0 {
		return fmt.Errorf("engine: regions have no class table: %w", ErrBadRegions)
	}
	for pos, label := range r.Labels {
		if int(label) >= len(r.ClassOf) {
			return fmt.Errorf("engine: region label %d at %d is outside the %d-cell class table: %w",
				label, pos, len(r.ClassOf), ErrBadRegions)
		}
	}
	for cell, class := range r.ClassOf {
		if int(class) >= len(r.Defs) {
			return fmt.Errorf("engine: cell %d names class %d, outside the %d class definitions: %w",
				cell, class, len(r.Defs), ErrBadRegions)
		}
	}
	return nil
}

// classes expands the label map into a per-pixel class map.
func (r *Regions) classes(w, h int) []uint8 {
	out := make([]uint8, w*h)
	for i := range out {
		out[i] = r.ClassOf[r.Labels[i]]
	}
	return out
}

// PartitionRegions is Partition for a region map. Each class is walked at its own angle (ClassDef.Angle, else the
// default), and a line is cut wherever the cell changes or a pixel of another class interrupts the walk. Every
// pixel is still in exactly one line, which is what keeps the one-buffer, one-pass design (PLAN.md 3.4).
//
// Angle groups are visited in ascending angle order. The mockup iterated an object here, which is harmless in
// JavaScript but would make the line order depend on Go's map iteration order: determinism rule 3.
func PartitionRegions(w, h, defaultAngle int, r *Regions) Lines {
	if r == nil {
		return Partition(w, h, defaultAngle)
	}
	cls := r.classes(w, h)

	// Group the classes that actually occur by the angle they are walked at. A class id is a byte, so a fixed
	// [256]bool replaces the maps this used to use: the loop below tests every pixel, and a map lookup per pixel made
	// the region-aware partition an order of magnitude slower than the plain one.
	var used [256]bool
	for _, c := range cls {
		used[c] = true
	}
	type group struct {
		angle int
		set   [256]bool
	}
	var groups []*group
	for c := range used { // ascending class id, so group creation order never depends on anything random
		if !used[c] {
			continue
		}
		angle := defaultAngle
		if c < len(r.Defs) && r.Defs[c].Angle != nil {
			angle = *r.Defs[c].Angle
		}
		var g *group
		for _, cand := range groups {
			if cand.angle == angle {
				g = cand
				break
			}
		}
		if g == nil {
			g = &group{angle: angle}
			groups = append(groups, g)
		}
		g.set[c] = true
	}
	slices.SortFunc(groups, func(a, b *group) int { return cmp.Compare(a.angle, b.angle) })

	P := make([]int32, 0, w*h)
	var starts []int32
	for _, g := range groups {
		part := Partition(w, h, g.angle)
		for l := 0; l < len(part.Starts)-1; l++ {
			open := false
			var prev uint16
			for i := part.Starts[l]; i < part.Starts[l+1]; i++ {
				pos := part.P[i]
				if !g.set[cls[pos]] {
					open = false
					continue
				}
				if open && r.Labels[pos] != prev {
					open = false
				}
				if !open {
					starts = append(starts, pos32(len(P)))
					open = true
				}
				P = append(P, pos)
				prev = r.Labels[pos]
			}
		}
	}
	return Lines{P: P, Starts: append(starts, pos32(len(P)))}
}
