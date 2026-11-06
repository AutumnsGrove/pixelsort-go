package helper

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"unicode"

	"github.com/AutumnsGrove/nova/tool"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

const (
	defaultTolerance = 28
	minTolerance     = 5
	maxTolerance     = 80
	maxNameRunes     = 60
	maxListed        = 12
	// cutoutMaxAreaPct matches the "Cut out this object" button, so what the model checks is what the page will make.
	cutoutMaxAreaPct = 45
)

// runState is what one run knows: the picture it was given, the areas it has listed or checked, and the proposal, if any. It is
// the only thing the tools can touch, and the tools can only read the picture.
type runState struct {
	mu      sync.Mutex
	im      *engine.Image
	regions map[string]region
	points  int
	prop    *Proposal
}

type region struct {
	seedX, seedY float64
	tolerance    int
	areaPct      float64
	colour       string
}

func newRunState(im *engine.Image) *runState { return &runState{im: im, regions: map[string]region{}} }

func (s *runState) proposed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.prop != nil
}

func (s *runState) proposal() Proposal {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.prop == nil {
		return Proposal{}
	}
	return *s.prop
}

// cleanText turns control and invisible characters into spaces, collapses runs of space, trims, and cuts to limit runes.
func cleanText(text string, limit int) string {
	var b strings.Builder
	for _, r := range text {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || unicode.IsSpace(r) {
			b.WriteRune(' ')
		} else {
			b.WriteRune(r)
		}
	}
	out := strings.Join(strings.Fields(b.String()), " ")
	if r := []rune(out); len(r) > limit {
		out = strings.TrimSpace(string(r[:limit]))
	}
	return out
}

func asJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"error":"could not encode the result"}`
	}
	return string(b)
}

func (s *runState) registry() *tool.Registry {
	reg := tool.NewRegistry()
	num := func(desc string) map[string]any { return map[string]any{"type": "number", "description": desc} }

	reg.MustRegister(tool.New(tool.Info{
		Name:        "describe_image",
		Description: "Summarise the picture: its size, dominant colours, how busy it is, and where it is brightest (as fractions of the picture).",
		Parameters:  map[string]any{"type": "object", "properties": map[string]any{}},
		Parallel:    true, ReadOnly: true,
	}, func(context.Context, json.RawMessage, *tool.Context) (tool.Result, error) {
		d := engine.Describe(s.im)
		return tool.Text("%s", asJSON(map[string]any{
			"width": d.W, "height": d.H, "palette": d.Palette, "edge_density": d.EdgeDensity,
			"brightest": map[string]float64{"x": d.BrightestX, "y": d.BrightestY},
		})), nil
	}))

	reg.MustRegister(tool.New(tool.Info{
		Name:        "list_objects",
		Description: "List the distinct areas of the picture, biggest first, each with an id (r1, r2, ...), a plain description, its share of the picture and a point inside it. Use these ids for the other tools.",
		Parameters: map[string]any{"type": "object", "properties": map[string]any{
			"min_area_pct": num("smallest area to list, as a percent of the picture (default 1)"),
			"max":          num("most areas to list (default 8, at most 12)"),
		}},
		Parallel: true, ReadOnly: true,
	}, func(_ context.Context, args json.RawMessage, _ *tool.Context) (tool.Result, error) {
		var in struct {
			Min float64 `json:"min_area_pct"`
			Max int     `json:"max"`
		}
		if len(args) > 0 {
			if err := json.Unmarshal(args, &in); err != nil {
				return tool.Errorf("the arguments are not valid JSON: %v", err), nil
			}
		}
		if in.Min <= 0 || math.IsNaN(in.Min) {
			in.Min = 1
		}
		if in.Max <= 0 {
			in.Max = 8
		}
		objs := engine.ListObjects(s.im, math.Min(in.Min, 90), min(in.Max, maxListed))
		type row struct {
			ID      string     `json:"id"`
			What    string     `json:"what"`
			AreaPct float64    `json:"area_pct"`
			Colour  string     `json:"colour"`
			BBox    [4]float64 `json:"bbox"`
			X       float64    `json:"x"`
			Y       float64    `json:"y"`
		}
		rows := make([]row, 0, len(objs))
		s.mu.Lock()
		for _, o := range objs {
			s.regions[o.ID] = region{seedX: o.SeedX, seedY: o.SeedY, tolerance: defaultTolerance, areaPct: o.AreaPct, colour: o.Colour}
			rows = append(rows, row{o.ID, o.Name, o.AreaPct, o.Colour, o.BBox, round3(o.SeedX), round3(o.SeedY)})
		}
		s.mu.Unlock()
		return tool.Text("%s", asJSON(map[string]any{"objects": rows})), nil
	}))

	reg.MustRegister(tool.New(tool.Info{
		Name:        "segment_from_point",
		Description: "Check one area: grow a region from a listed object (region) or from a point (x, y as fractions of the picture) and report how big it is. A looser tolerance includes more of nearby colours. Returns a region id you can propose.",
		Parameters: map[string]any{"type": "object", "properties": map[string]any{
			"region":    map[string]any{"type": "string", "description": "an id from list_objects"},
			"x":         num("0 to 1 across the picture, if no region is given"),
			"y":         num("0 to 1 down the picture, if no region is given"),
			"tolerance": num("5 to 80, default 28"),
		}},
		Parallel: true, ReadOnly: true,
	}, func(_ context.Context, args json.RawMessage, _ *tool.Context) (tool.Result, error) {
		var in struct {
			Region    string   `json:"region"`
			X         *float64 `json:"x"`
			Y         *float64 `json:"y"`
			Tolerance int      `json:"tolerance"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return tool.Errorf("the arguments are not valid JSON: %v", err), nil
		}
		tol := in.Tolerance
		if tol == 0 {
			tol = defaultTolerance
		}
		if tol < minTolerance || tol > maxTolerance {
			return tool.Errorf("tolerance must be between %d and %d", minTolerance, maxTolerance), nil
		}
		id, x, y := in.Region, 0.0, 0.0
		s.mu.Lock()
		switch {
		case id != "":
			r, ok := s.regions[id]
			if !ok {
				s.mu.Unlock()
				return tool.Errorf("there is no region %q: use an id from list_objects", id), nil
			}
			x, y = r.seedX, r.seedY
		case in.X != nil && in.Y != nil:
			x, y = *in.X, *in.Y
			if math.IsNaN(x) || math.IsNaN(y) || x < 0 || x > 1 || y < 0 || y > 1 {
				s.mu.Unlock()
				return tool.Errorf("x and y must be between 0 and 1"), nil
			}
		default:
			s.mu.Unlock()
			return tool.Errorf("give a region id from list_objects, or both x and y"), nil
		}
		s.mu.Unlock()

		c, err := engine.CutOut(s.im, int(x*float64(s.im.W)), int(y*float64(s.im.H)), tol, cutoutMaxAreaPct)
		switch {
		case errors.Is(err, engine.ErrCutoutTooBig):
			return tool.Text("%s", asJSON(map[string]any{"ok": false, "reason": "too_big", "advice": "that area spreads over too much of the picture; lower the tolerance or choose a more distinct spot"})), nil
		case errors.Is(err, engine.ErrCutoutTooSmall):
			return tool.Text("%s", asJSON(map[string]any{"ok": false, "reason": "too_small", "advice": "that area is too small or thin to be a shape; raise the tolerance or choose a bigger area"})), nil
		case err != nil:
			return tool.Errorf("could not check that area"), nil //nolint:nilerr // a failed check is a result the model reads, not a failed run
		}
		areaPct := math.Round(float64(c.Area)*1000/float64(s.im.W*s.im.H)) / 10
		s.mu.Lock()
		if id == "" {
			s.points++
			id = fmt.Sprintf("p%d", s.points)
		}
		s.regions[id] = region{seedX: x, seedY: y, tolerance: tol, areaPct: areaPct, colour: hexOf(c.Mean)}
		s.mu.Unlock()
		return tool.Text("%s", asJSON(map[string]any{
			"ok": true, "region": id, "area_pct": areaPct, "outline_points": len(c.Outline), "tolerance": tol,
			"colour": hexOf(c.Mean), "bbox": [4]float64{
				round3(float64(c.BBox[0]) / float64(s.im.W)), round3(float64(c.BBox[1]) / float64(s.im.H)),
				round3(float64(c.BBox[2]) / float64(s.im.W)), round3(float64(c.BBox[3]) / float64(s.im.H)),
			},
		})), nil
	}))

	reg.MustRegister(tool.New(tool.Info{
		Name:        "propose_shape",
		Description: "Finish: propose one listed or checked area as the shape, with a short name. The person decides whether to use it. Call this once, last.",
		Parameters: map[string]any{"type": "object", "properties": map[string]any{
			"region": map[string]any{"type": "string", "description": "an id from list_objects or segment_from_point"},
			"name":   map[string]any{"type": "string", "description": "a short plain name, at most 60 characters"},
		}, "required": []string{"region"}},
	}, func(_ context.Context, args json.RawMessage, _ *tool.Context) (tool.Result, error) {
		var in struct{ Region, Name string }
		if err := json.Unmarshal(args, &in); err != nil {
			return tool.Errorf("the arguments are not valid JSON: %v", err), nil
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		r, ok := s.regions[in.Region]
		if !ok {
			return tool.Errorf("there is no region %q: list_objects first and use one of its ids", in.Region), nil
		}
		// make sure the area really is a shape before it is proposed: the page will cut out from the same spot
		if _, err := engine.CutOut(s.im, int(r.seedX*float64(s.im.W)), int(r.seedY*float64(s.im.H)), r.tolerance, cutoutMaxAreaPct); err != nil {
			return tool.Errorf("that area cannot be made into a shape (%v); try another or change the tolerance", err), nil
		}
		name := cleanText(in.Name, maxNameRunes)
		if name == "" {
			name = "Shape"
		}
		s.prop = &Proposal{Region: in.Region, Name: name, SeedX: round3(r.seedX), SeedY: round3(r.seedY), Tolerance: r.tolerance, AreaPct: r.areaPct, Colour: r.colour}
		return tool.Text("proposal shown to the person"), nil
	}))
	return reg
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

func hexOf(c [3]uint8) string { return fmt.Sprintf("#%02x%02x%02x", c[0], c[1], c[2]) }
