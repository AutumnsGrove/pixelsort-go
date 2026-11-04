// Package api is the coarse boundary between a host (the WebAssembly binding, a test) and the engine: one Session
// holds an image, a recipe and the result. It is plain Go so every rule is tested natively; cmd/wasm only converts
// values (decision B1).
package api

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// ErrState means a call was made out of order, for example Prepare before Configure.
var ErrState = errors.New("api: call out of order")

// Session is one image being sorted. It is not safe for concurrent use: Go WebAssembly is single threaded.
type Session struct {
	w, h    int
	inited  bool
	image   *engine.Image
	regions *engine.Regions
	mask    []uint8
	soft    int
	params  engine.Params
	hasCfg  bool
	plan    *engine.Plan
	result  *engine.Image
}

// NewSession returns an empty session; call Init first.
func NewSession() *Session { return &Session{} }

// Version is the engine behaviour version, stored with every run.
func Version() string { return engine.EngineVersion }

// Init allocates an empty w x h working image and drops every earlier setting, plan and result.
func (s *Session) Init(w, h int) error {
	im, err := engine.NewImage(w, h)
	if err != nil {
		return fmt.Errorf("api: init: %w", err)
	}
	*s = Session{w: w, h: h, inited: true, image: im}
	return nil
}

// Size returns the working size, or 0, 0 before Init.
func (s *Session) Size() (w, h int) { return s.w, s.h }

// SetImage copies RGBA bytes (4 per pixel) in as the image to sort.
func (s *Session) SetImage(rgba []byte) error {
	if !s.inited {
		return fmt.Errorf("api: set image before init: %w", ErrState)
	}
	im, err := engine.FromRGBA(s.w, s.h, rgba)
	if err != nil {
		return fmt.Errorf("api: set image: %w", err)
	}
	s.image = im
	s.invalidate()
	return nil
}

// SetRegions installs a region map. Pass nil labels to clear it. defsJSON is a JSON array of engine.ClassDef.
func (s *Session) SetRegions(labels []uint16, classOf []uint8, defsJSON []byte) error {
	if !s.inited {
		return fmt.Errorf("api: set regions before init: %w", ErrState)
	}
	if labels == nil {
		s.regions = nil
		s.invalidate()
		return nil
	}
	var defs []engine.ClassDef
	if err := json.Unmarshal(defsJSON, &defs); err != nil {
		return fmt.Errorf("api: class definitions: %w", err)
	}
	r := &engine.Regions{Labels: append([]uint16(nil), labels...), ClassOf: append([]uint8(nil), classOf...), Defs: defs}
	if err := r.Validate(s.w, s.h); err != nil {
		return fmt.Errorf("api: set regions: %w", err)
	}
	s.regions = r
	s.invalidate()
	return nil
}

// SetMask installs a frozen mask (non-zero = frozen). Pass nil to clear it.
func (s *Session) SetMask(mask []uint8) error {
	if !s.inited {
		return fmt.Errorf("api: set mask before init: %w", ErrState)
	}
	if mask != nil && len(mask) != s.w*s.h {
		return fmt.Errorf("api: mask has %d bytes for a %dx%d image", len(mask), s.w, s.h)
	}
	s.mask = append([]uint8(nil), mask...)
	if mask == nil {
		s.mask = nil
	}
	s.invalidate()
	return nil
}

// SetSoft sets the feather radius in pixels; 0 clears it. It only has an effect when a mask is set.
func (s *Session) SetSoft(radius int) error {
	if !s.inited {
		return fmt.Errorf("api: set soft before init: %w", ErrState)
	}
	if radius < 0 || radius > 1000 {
		return fmt.Errorf("api: feather radius %d outside 0..1000", radius)
	}
	s.soft = radius
	s.invalidate()
	return nil
}

// Configure parses and validates a recipe. It invalidates any plan.
func (s *Session) Configure(paramsJSON []byte) error {
	if !s.inited {
		return fmt.Errorf("api: configure before init: %w", ErrState)
	}
	p, err := engine.ParseParams(paramsJSON)
	if err != nil {
		return fmt.Errorf("api: configure: %w", err)
	}
	s.params, s.hasCfg = p, true
	s.invalidate()
	return nil
}

// Prepare builds the plan from everything set so far.
func (s *Session) Prepare() (engine.Stats, error) {
	if !s.inited || !s.hasCfg {
		return engine.Stats{}, fmt.Errorf("api: prepare needs init and configure: %w", ErrState)
	}
	opts := &engine.Options{Regions: s.regions, Mask: s.mask}
	if s.mask != nil && s.soft > 0 {
		opts.Soft = engine.Feather(s.mask, s.w, s.h, s.soft)
	}
	pl, err := engine.NewPlan(s.image, s.params, opts)
	if err != nil {
		return engine.Stats{}, fmt.Errorf("api: prepare: %w", err)
	}
	s.plan, s.result = pl, nil
	return pl.Stats, nil
}

// FinishInstant sorts everything at once; the result becomes the current pixels.
func (s *Session) FinishInstant() error {
	if s.plan == nil {
		return fmt.Errorf("api: finish before prepare: %w", ErrState)
	}
	s.result = s.plan.Sort()
	return nil
}

// Pixels returns the current pixel buffer: the original until FinishInstant, the sorted image after. Nil before Init.
// The slice stays valid until the next Init, SetImage or FinishInstant.
func (s *Session) Pixels() []uint32 {
	switch {
	case s.result != nil:
		return s.result.Pix
	case s.image != nil:
		return s.image.Pix
	}
	return nil
}

// invalidate drops the plan and result after any input changed.
func (s *Session) invalidate() { s.plan, s.result = nil, nil }
