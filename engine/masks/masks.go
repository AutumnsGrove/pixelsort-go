// Package masks rasterises a mask described as vectors (shape objects and brush strokes) into the 0/1 plane the engine
// treats as frozen. Positions are fractions of the picture, so a preview and a full-resolution export agree
// (PLAN.md 3.4). Port of MaskEditor.rasterize in mockups/shared/mask-editor.js.
//
// Edges are hard (no anti-aliasing) and geometry follows the shapes package's float rule: every product is wrapped in
// float64(...) so arm64 cannot fuse a multiply-add.
package masks

import (
	"math"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/engine/shapes"
)

// Object is one editable shape. CX, CY, W and H are fractions of the picture; Rot is degrees.
type Object struct {
	Kind string         `json:"kind"` // ellipse | rect | polygon
	CX   float64        `json:"cx"`
	CY   float64        `json:"cy"`
	W    float64        `json:"w"`
	H    float64        `json:"h"`
	Rot  float64        `json:"rot"`
	Mode string         `json:"mode"`           // add (freeze) | cut (punch a hole)
	Poly [][2]float64   `json:"poly,omitempty"` // polygon kind: outline in the unit square
	More [][][2]float64 `json:"more,omitempty"`
}

// Stroke is a round-capped brush polyline. Radius is a fraction of the picture width; Points are fractions.
type Stroke struct {
	Radius float64      `json:"radius"`
	Erase  bool         `json:"erase,omitempty"`
	Points [][2]float64 `json:"points"`
}

// Spec is a whole mask: strokes first (in order), then objects (in order), then an optional inversion.
type Spec struct {
	Objects []Object `json:"objects,omitempty"`
	Strokes []Stroke `json:"strokes,omitempty"`
	Invert  bool     `json:"invert,omitempty"`
	Feather float64  `json:"feather,omitempty"` // fraction of the width; 0 = hard
}

const bitmapSize = 72

// Rasterize returns a w*h plane, 1 = frozen. Objects of an unknown kind are ignored; a polygon that cannot be
// rasterised (too few points) is ignored too, so a half-drawn shape never fails a sort.
func Rasterize(w, h int, s Spec) []uint8 {
	out := make([]uint8, w*h)
	for _, st := range s.Strokes {
		paintStroke(out, w, h, st)
	}
	for _, o := range s.Objects {
		paintObject(out, w, h, o)
	}
	if s.Invert {
		for i, v := range out {
			out[i] = 1 - v
		}
	}
	return out
}

func paintObject(out []uint8, w, h int, o Object) {
	var bits []uint8
	switch o.Kind {
	case "ellipse", "rect":
	case "polygon":
		var err error
		if bits, err = shapes.PolyBitmap(o.Poly, o.More, bitmapSize); err != nil {
			return
		}
	default:
		return
	}
	v := uint8(1)
	if o.Mode == "cut" {
		v = 0
	}
	W, H := float64(w), float64(h)
	hw, hh := float64(o.W*W)/2, float64(o.H*H)/2
	if hw <= 0 || hh <= 0 {
		return
	}
	sin, cos := sincos(o.Rot)
	cx, cy := float64(o.CX*W), float64(o.CY*H)
	ex := math.Abs(float64(hw*cos)) + math.Abs(float64(hh*sin))
	ey := math.Abs(float64(hw*sin)) + math.Abs(float64(hh*cos))
	x0, x1 := max(0, int(math.Floor(cx-ex))), min(w-1, int(math.Ceil(cx+ex)))
	y0, y1 := max(0, int(math.Floor(cy-ey))), min(h-1, int(math.Ceil(cy+ey)))
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			dx, dy := float64(x)+0.5-cx, float64(y)+0.5-cy
			lx := float64(dx*cos) + float64(dy*sin)
			ly := float64(-dx*sin) + float64(dy*cos)
			u, vv := lx/hw, ly/hh
			var inside bool
			switch o.Kind {
			case "ellipse":
				inside = float64(u*u)+float64(vv*vv) <= 1
			case "rect":
				inside = math.Abs(u) <= 1 && math.Abs(vv) <= 1
			default:
				bx, by := (u+1)/2, (vv+1)/2
				inside = bx >= 0 && bx < 1 && by >= 0 && by < 1 && bits[int(math.Floor(by*bitmapSize))*bitmapSize+int(math.Floor(bx*bitmapSize))] == 1
			}
			if inside {
				out[y*w+x] = v
			}
		}
	}
}

// paintStroke draws a polyline of round-capped segments: every pixel centre within Radius of any segment.
func paintStroke(out []uint8, w, h int, s Stroke) {
	if len(s.Points) == 0 || s.Radius <= 0 {
		return
	}
	v := uint8(1)
	if s.Erase {
		v = 0
	}
	W, H := float64(w), float64(h)
	r := float64(s.Radius * W)
	r2 := float64(r * r)
	pts := s.Points
	for i := 0; i < len(pts); i++ {
		ax, ay := float64(pts[i][0]*W), float64(pts[i][1]*H)
		bx, by := ax, ay
		if i+1 < len(pts) {
			bx, by = float64(pts[i+1][0]*W), float64(pts[i+1][1]*H)
		}
		x0, x1 := max(0, int(math.Floor(math.Min(ax, bx)-r))), min(w-1, int(math.Ceil(math.Max(ax, bx)+r)))
		y0, y1 := max(0, int(math.Floor(math.Min(ay, by)-r))), min(h-1, int(math.Ceil(math.Max(ay, by)+r)))
		dx, dy := bx-ax, by-ay
		l2 := float64(dx*dx) + float64(dy*dy)
		for y := y0; y <= y1; y++ {
			for x := x0; x <= x1; x++ {
				px, py := float64(x)+0.5-ax, float64(y)+0.5-ay
				t := 0.0
				if l2 > 0 {
					t = math.Min(1, math.Max(0, (float64(px*dx)+float64(py*dy))/l2))
				}
				qx, qy := px-float64(t*dx), py-float64(t*dy)
				if float64(qx*qx)+float64(qy*qy) <= r2 {
					out[y*w+x] = v
				}
			}
		}
	}
}

// Soft turns a hard mask into the feather plane the plan blends with: engine.Feather with radius round(fraction*w).
func Soft(w, h int, mask []uint8, featherFraction float64) []uint8 {
	return engine.Feather(mask, w, h, int(math.Round(float64(featherFraction*float64(w)))))
}

// sincos is Sincos of degrees, exact at quarter turns so a rotated rectangle lands exactly on pixel edges.
func sincos(deg float64) (sin, cos float64) {
	d := math.Mod(deg, 360)
	if d < 0 {
		d += 360
	}
	switch d {
	case 0:
		return 0, 1
	case 90:
		return 1, 0
	case 180:
		return 0, -1
	case 270:
		return -1, 0
	}
	return math.Sincos(float64(d * math.Pi / 180))
}
