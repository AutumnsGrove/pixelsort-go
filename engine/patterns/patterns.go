// Package patterns rasterises a family of generative patterns into the 0/1 plane the engine reads along its sort
// lines. It is the same shape of object as a cellular-automaton mask (engine/ca.go), but the pattern is drawn from
// tiles, waves or polar coordinates instead of a Wolfram rule, which gives the sort far more intricate edges.
//
// The families are our own implementations, inspired by the pattern families on bookofshapes.com (Truchet, flow,
// interference, radial, isometric). Nothing here is copied from that site: its pattern definitions and source are not
// covered by its licence, and redistributing the patterns as patterns is the one thing that licence forbids. Its
// licence does allow using what it generates, so a picture made with these patterns is the maker's to keep.
//
// Geometry follows the shapes package's rule (decision E6): every product is wrapped in float64(...) so arm64 cannot
// fuse a multiply-add, and a golden per variant decides whether the result is portable. If a variant ever differs
// between arm64, amd64 and WASM, it moves to fixed point.
package patterns

import (
	"errors"
	"fmt"
	"math"
)

// ErrSpec means a pattern spec is out of range or names something that does not exist.
var ErrSpec = errors.New("patterns: invalid spec")

// Spec is one pattern: which family and variant, and the knobs that shape it. Cell and Thickness are per mille of
// Width, so a preview and a full-resolution export agree (decision E4). Width is the reference width for those
// conversions; zero means the mask's own width, and a line-space mask passes the picture's width instead.
type Spec struct {
	Family    string `json:"family"`
	Variant   string `json:"variant"`
	Seed      uint32 `json:"seed"`
	Cell      int    `json:"cell"`      // per mille of the reference width, 1..1000
	Thickness int    `json:"thickness"` // per mille of the reference width, 1..500
	Rotate    int    `json:"rotate"`    // whole degrees, 0..359
	Detail    int    `json:"detail"`    // arms, spokes or gaps, 1..16
	Invert    bool   `json:"invert"`
	Width     int    `json:"-"` // reference width, 0 = the mask width
}

// Variant is one drawing of a family.
type Variant struct {
	Name string `json:"name"`
	Note string `json:"note"`
}

// Family is a group of variants that share a drawing idea.
type Family struct {
	Name     string    `json:"name"`
	Note     string    `json:"note"`
	Variants []Variant `json:"variants"`
}

// Catalog returns the families and variants the UI may offer, in the order it should show them. It is a fresh copy,
// so a caller cannot change the catalog the rest of the package sees.
func Catalog() []Family {
	return []Family{
		{
			Name: "truchet", Note: "Tiles whose seams join into arcs and ribbons.",
			Variants: []Variant{
				{Name: "arc", Note: "Quarter circles that meet at the tile corners."},
				{Name: "strand", Note: "Diagonal ribbons, alternating direction."},
				{Name: "hex", Note: "A honeycomb wireframe with random gaps."},
			},
		},
		{
			Name: "interference", Note: "Two waves crossing.",
			Variants: []Variant{
				{Name: "mesh", Note: "Two rotated gratings, crossing."},
				{Name: "rings", Note: "Concentric rings from two centres."},
			},
		},
		{
			Name: "radial", Note: "Everything around the centre.",
			Variants: []Variant{
				{Name: "spiral", Note: "Arms winding out from the middle."},
				{Name: "spokes", Note: "Rays from the centre."},
				{Name: "broken", Note: "Rings with regular gaps."},
			},
		},
		{
			Name: "grid", Note: "Straight-edged lattices.",
			Variants: []Variant{
				{Name: "woven", Note: "Short bands, alternating direction, like a weave."},
				{Name: "chevron", Note: "V-shaped stripes."},
				{Name: "iso", Note: "An isometric triangular wireframe."},
			},
		},
	}
}

// Families returns the family names, in catalog order.
func Families() []string {
	fams := Catalog()
	out := make([]string, len(fams))
	for i, f := range fams {
		out[i] = f.Name
	}
	return out
}

// DefaultVariant returns the variant a family starts on, or "" for an unknown family.
func DefaultVariant(family string) string {
	for _, f := range Catalog() {
		if f.Name == family && len(f.Variants) > 0 {
			return f.Variants[0].Name
		}
	}
	return ""
}

// Validate reports the first problem with a spec. An empty Variant is allowed and means the family's first variant.
func Validate(s Spec) error {
	_, err := check(s)
	return err
}

// Mask draws the pattern as a w*h plane of 0/1 bytes (1 = on). It never returns a partially drawn mask: a bad spec is
// an error before any pixel is written.
func Mask(w, h int, s Spec) ([]uint8, error) {
	if w < 1 || h < 1 || w > 1<<14 || h > 1<<14 {
		return nil, fmt.Errorf("%w: %dx%d mask", ErrSpec, w, h)
	}
	s, err := check(s)
	if err != nil {
		return nil, err
	}
	ref := s.Width
	if ref == 0 {
		ref = w
	}
	cell := perMille(ref, s.Cell)
	thick := perMille(ref, s.Thickness)
	out := make([]uint8, w*h)
	f := newFrame(w, h, s.Rotate)
	switch s.Family {
	case "truchet":
		truchet(out, w, h, s.Variant, f, cell, thick, s.Seed)
	case "interference":
		interference(out, w, h, s.Variant, f, cell, thick, s.Seed)
	case "radial":
		radial(out, w, h, s.Variant, f, cell, thick, s.Detail)
	case "grid":
		grid(out, w, h, s.Variant, f, cell, thick, s.Seed)
	default:
		return nil, fmt.Errorf("%w: family %q", ErrSpec, s.Family)
	}
	if s.Invert {
		for i := range out {
			out[i] ^= 1
		}
	}
	return out, nil
}

// check fills an empty variant and validates every field, so Mask and Validate agree about what is legal.
func check(s Spec) (Spec, error) {
	var fam *Family
	fams := Catalog()
	for i := range fams {
		if fams[i].Name == s.Family {
			fam = &fams[i]
			break
		}
	}
	if fam == nil {
		return s, fmt.Errorf("%w: unknown family %q", ErrSpec, s.Family)
	}
	if s.Variant == "" {
		s.Variant = fam.Variants[0].Name
	}
	known := false
	for _, v := range fam.Variants {
		if v.Name == s.Variant {
			known = true
			break
		}
	}
	if !known {
		return s, fmt.Errorf("%w: family %q has no variant %q", ErrSpec, s.Family, s.Variant)
	}
	switch {
	case s.Cell < 1 || s.Cell > 1000:
		return s, fmt.Errorf("%w: cell %d outside 1..1000", ErrSpec, s.Cell)
	case s.Thickness < 1 || s.Thickness > 500:
		return s, fmt.Errorf("%w: thickness %d outside 1..500", ErrSpec, s.Thickness)
	case s.Rotate < 0 || s.Rotate > 359:
		return s, fmt.Errorf("%w: rotate %d outside 0..359", ErrSpec, s.Rotate)
	case s.Detail < 1 || s.Detail > 16:
		return s, fmt.Errorf("%w: detail %d outside 1..16", ErrSpec, s.Detail)
	case s.Width < 0 || s.Width > 1<<14:
		return s, fmt.Errorf("%w: width %d outside 0..%d", ErrSpec, s.Width, 1<<14)
	}
	return s, nil
}

// perMille converts a per-mille value to pixels at a reference width, never below one (decision E4).
func perMille(w, v int) int { return max(1, (w*v+500)/1000) }

// frame rotates sample points around the picture's centre by -Rotate, so the pattern turns clockwise with a positive
// Rotate. Sincos is exact at quarter turns, so a 90-degree turn puts pixels exactly on the pattern grid.
type frame struct {
	cx, cy   float64
	sin, cos float64
}

func newFrame(w, h, rotate int) frame {
	sin, cos := sincosDeg(-rotate)
	return frame{cx: float64(w) / 2, cy: float64(h) / 2, sin: sin, cos: cos}
}

// at returns the pattern-space coordinates of a pixel centre.
func (f frame) at(x, y int) (float64, float64) {
	dx := float64(x) + 0.5 - f.cx
	dy := float64(y) + 0.5 - f.cy
	u := float64(dx*f.cos) - float64(dy*f.sin) + f.cx
	v := float64(dx*f.sin) + float64(dy*f.cos) + f.cy
	return u, v
}

// sincosDeg is Sincos of whole degrees, exact at multiples of 90 so a quarter turn lands on the pattern grid.
func sincosDeg(deg int) (sin, cos float64) {
	switch ((deg % 360) + 360) % 360 {
	case 0:
		return 0, 1
	case 90:
		return 1, 0
	case 180:
		return 0, -1
	case 270:
		return -1, 0
	}
	return math.Sincos(float64(deg) * math.Pi / 180)
}

// hash is a small deterministic 32-bit mix, so a tile's orientation depends only on its coordinates and the seed.
func hash(x, y int32, seed uint32) uint32 {
	//nolint:gosec // G115: a wrapping 32-bit mix; a negative tile coordinate is meant to wrap
	h := uint32(x)*0x9E3779B1 ^ uint32(y)*0x85EBCA77 ^ seed*0xC2B2AE3D
	h ^= h >> 16
	h *= 0x7FEB352D
	h ^= h >> 15
	h *= 0x846CA68B
	h ^= h >> 16
	return h
}
