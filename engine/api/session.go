// Package api is the coarse boundary between a host (the WebAssembly binding, a test) and the engine: one Session
// holds an image, a recipe and the result. It is plain Go so every rule is tested natively; cmd/wasm only converts
// values (decision B1).
package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"slices"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/engine/masks"
	"github.com/AutumnsGrove/pixelsort-go/engine/shapes"
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
	stepper *engine.Stepper

	// Checkpoints for scrubbing: clones of the stepper at some earlier passes, oldest first, so a seek replays only the passes
	// since the nearest one. They belong to the current plan and are dropped whenever it changes.
	ckpt       []*engine.Stepper
	ckptStride int
}

const (
	// ckptFirstStride is how often (in passes) a checkpoint is taken at first; it doubles whenever the cache fills. It starts
	// at every pass because a sort may have only a dozen passes (merge) that each cost a lot; a long one (odd-even) soon
	// settles on a stride of tens or hundreds.
	ckptFirstStride = 1
	// ckptBudget bounds the memory the checkpoints may use. A checkpoint costs about 5 bytes a pixel (the pixels and their keys).
	ckptBudget = 96 << 20
)

// maxCheckpoints is how many checkpoints fit in the budget at this size (at least 2, at most 16).
func (s *Session) maxCheckpoints() int {
	return min(16, max(2, ckptBudget/max(1, s.w*s.h*5)))
}

// noteCheckpoint keeps a clone of the stepper when it has just reached a multiple of the stride. When the cache is full it
// drops every checkpoint that is not on a multiple of twice the stride, and doubles the stride, so the kept ones stay evenly
// spread however long the sort turns out to be.
func (s *Session) noteCheckpoint() {
	if s.ckptStride == 0 {
		s.ckptStride = ckptFirstStride
	}
	p := s.stepper.Pass()
	if p == 0 || p%s.ckptStride != 0 || (len(s.ckpt) > 0 && s.ckpt[len(s.ckpt)-1].Pass() >= p) {
		return
	}
	s.ckpt = append(s.ckpt, s.stepper.Clone())
	if len(s.ckpt) > s.maxCheckpoints() {
		s.ckptStride *= 2
		s.ckpt = slices.DeleteFunc(s.ckpt, func(c *engine.Stepper) bool { return c.Pass()%s.ckptStride != 0 })
	}
}

// nearestCheckpoint is the latest checkpoint at or before pass, or nil.
func (s *Session) nearestCheckpoint(pass int) *engine.Stepper {
	for i := len(s.ckpt) - 1; i >= 0; i-- {
		if s.ckpt[i].Pass() <= pass {
			return s.ckpt[i]
		}
	}
	return nil
}

func (s *Session) dropCheckpoints() { s.ckpt, s.ckptStride = nil, 0 }

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

// SetTiling tessellates the working image from a JSON tiling spec, classifies the cells by the spec's pattern and
// installs the result as the region map. defsJSON is an optional JSON array of class definitions; class 0 (the gaps)
// is frozen unless it supplies its own. Nil specJSON clears the regions. Because the spec is vector, the same call at
// another size (a full-resolution export) gives the same character of result.
func (s *Session) SetTiling(specJSON, defsJSON []byte) error {
	if !s.inited {
		return fmt.Errorf("api: set tiling before init: %w", ErrState)
	}
	if specJSON == nil {
		s.regions = nil
		s.invalidate()
		return nil
	}
	var t shapes.Tiling
	if err := decodeStrict(specJSON, &t); err != nil {
		return fmt.Errorf("api: tiling: %w", err)
	}
	var defs []engine.ClassDef
	if len(defsJSON) > 0 {
		if err := json.Unmarshal(defsJSON, &defs); err != nil {
			return fmt.Errorf("api: class definitions: %w", err)
		}
	}
	cells, err := shapes.Tessellate(s.w, s.h, t)
	if err != nil {
		return fmt.Errorf("api: tiling: %w", err)
	}
	r := shapes.BuildRegions(cells, shapes.Classify(cells, t.Pattern, t.Kinds, t.Seed), defs)
	if err := r.Validate(s.w, s.h); err != nil {
		return fmt.Errorf("api: tiling: %w", err)
	}
	s.regions = r
	s.invalidate()
	return nil
}

// SetMaskSpec rasterises a JSON mask spec (objects, strokes, invert, feather) at the working size and installs it as the
// frozen mask, with a soft edge when the spec asks for one. Nil clears both.
func (s *Session) SetMaskSpec(specJSON []byte) error {
	if !s.inited {
		return fmt.Errorf("api: set mask spec before init: %w", ErrState)
	}
	if specJSON == nil {
		s.mask, s.soft = nil, 0
		s.invalidate()
		return nil
	}
	var spec masks.Spec
	if err := decodeStrict(specJSON, &spec); err != nil {
		return fmt.Errorf("api: mask spec: %w", err)
	}
	if spec.Feather < 0 || spec.Feather > 0.5 {
		return fmt.Errorf("api: feather %v outside 0..0.5", spec.Feather)
	}
	s.mask = masks.Rasterize(s.w, s.h, spec)
	s.soft = int(math.Round(spec.Feather * float64(s.w)))
	s.invalidate()
	return nil
}

func decodeStrict(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return errors.New("unexpected data after the value")
	}
	return nil
}

// Labels is the current region map, one id per pixel (nil if none), for drawing outlines.
func (s *Session) Labels() []uint16 {
	if s.regions == nil {
		return nil
	}
	return s.regions.Labels
}

// ClassOf is the class of each cell id of the current region map (nil if none).
func (s *Session) ClassOf() []uint8 {
	if s.regions == nil {
		return nil
	}
	return s.regions.ClassOf
}

// BrightestSpot finds the brightest blob of the picture as an ellipse in fractions of the picture.
func (s *Session) BrightestSpot() (cx, cy, w, h float64, err error) {
	if !s.inited {
		return 0, 0, 0, 0, fmt.Errorf("api: brightest spot before init: %w", ErrState)
	}
	cx, cy, w, h = engine.BrightestSpot(s.image)
	return cx, cy, w, h, nil
}

// Sortable marks 1 where a pixel belongs to some interval of the prepared plan: what the recipe lets move.
func (s *Session) Sortable() ([]uint8, error) {
	if s.plan == nil {
		return nil, fmt.Errorf("api: sortable before prepare: %w", ErrState)
	}
	out := make([]uint8, s.w*s.h)
	for _, iv := range s.plan.Intervals {
		for i := iv.A; i < iv.B; i++ {
			out[s.plan.Lines.P[i]] = 1
		}
	}
	return out, nil
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
	s.plan, s.result, s.stepper = pl, nil, nil
	s.dropCheckpoints()
	return pl.Stats, nil
}

// FinishInstant sorts everything at once; the result becomes the current pixels.
func (s *Session) FinishInstant() error {
	if s.plan == nil {
		return fmt.Errorf("api: finish before prepare: %w", ErrState)
	}
	s.result = s.plan.Sort()
	s.stepper = nil
	return nil
}

// Reset starts (or restarts) a stepped sort of the prepared plan: the pixels return to the original.
func (s *Session) Reset() error {
	if s.plan == nil {
		return fmt.Errorf("api: reset before prepare: %w", ErrState)
	}
	s.stepper, s.result = s.plan.NewStepper(), nil
	return nil
}

// MaxStepsPerCall bounds Step's n so one call cannot monopolise the worker for long.
const MaxStepsPerCall = 10000

// Step advances up to n passes (1..MaxStepsPerCall), stopping early once the sort is done.
func (s *Session) Step(n int) (done bool, err error) {
	if s.stepper == nil {
		return false, fmt.Errorf("api: step before reset: %w", ErrState)
	}
	if n < 1 || n > MaxStepsPerCall {
		return false, fmt.Errorf("api: step count %d outside 1..%d", n, MaxStepsPerCall)
	}
	for i := 0; i < n; i++ {
		if s.stepper.Step() {
			return true, nil
		}
		s.noteCheckpoint()
	}
	return s.stepper.Done(), nil
}

// MaxSeekPass bounds Seek's target so a typo cannot ask for an endless replay (a sort ends on its own long before this).
const MaxSeekPass = 1_000_000

// Seek moves the stepped sort to the state after `pass` passes: the same pixels, and the same Pass(), as a fresh Reset
// followed by that many single steps. It never stores a frame: going forward it steps on from where it is; going
// backward it resets to the original and replays (the sort is deterministic, PLAN.md 3.7). A target past the end stops at the
// end and reports done. Seek works straight after Prepare (it starts the stepper if there is none).
func (s *Session) Seek(pass int) (done bool, err error) {
	if s.plan == nil {
		return false, fmt.Errorf("api: seek before prepare: %w", ErrState)
	}
	if pass < 0 || pass > MaxSeekPass {
		return false, fmt.Errorf("api: seek pass %d outside 0..%d", pass, MaxSeekPass)
	}
	// Start from the nearest earlier state: a checkpoint if one is closer than where we are (or we are past the target),
	// otherwise the original.
	near := s.nearestCheckpoint(pass)
	switch {
	case s.stepper != nil && pass >= s.stepper.Pass() && (near == nil || near.Pass() <= s.stepper.Pass()):
		// keep going from here
	case near != nil:
		s.stepper, s.result = near.Clone(), nil // clone: stepping on must not change the checkpoint
	default:
		if err := s.Reset(); err != nil {
			return false, err
		}
	}
	for s.stepper.Pass() < pass {
		if s.stepper.Step() {
			return true, nil
		}
		s.noteCheckpoint()
	}
	return s.stepper.Done(), nil
}

// Progress is 0..1 for the stepped sort; 1 after FinishInstant, 0 before any Reset.
func (s *Session) Progress() float64 {
	switch {
	case s.stepper != nil:
		return s.stepper.Progress()
	case s.result != nil:
		return 1
	}
	return 0
}

// Pass is the number of passes the stepper has run.
func (s *Session) Pass() int {
	if s.stepper == nil {
		return 0
	}
	return s.stepper.Pass()
}

// Pixels returns the current pixel buffer: the original until FinishInstant or Reset, then the sorted image or the
// stepper's live image. With a feather the stepper blends into a scratch buffer on every call, so re-fetch per frame. Nil before Init.
// The slice stays valid until the next Init, SetImage or FinishInstant.
func (s *Session) Pixels() []uint32 {
	switch {
	case s.stepper != nil:
		return s.stepper.Image().Pix
	case s.result != nil:
		return s.result.Pix
	case s.image != nil:
		return s.image.Pix
	}
	return nil
}

// invalidate drops the plan and result after any input changed.
func (s *Session) invalidate() {
	s.plan, s.result, s.stepper = nil, nil, nil
	s.dropCheckpoints()
}

var knownKeys = map[engine.SortKey]bool{
	engine.KeyLuma: true, engine.KeyValue: true, engine.KeyIntensity: true, engine.KeyMinimum: true, engine.KeyHue: true,
	engine.KeySaturation: true, engine.KeyRed: true, engine.KeyGreen: true, engine.KeyBlue: true, engine.KeyAlpha: true,
}

// Histogram counts the working copy's pixels by the 0..255 value of a sort key, for the threshold band picker. The counts
// add up to w*h.
func (s *Session) Histogram(key string) ([256]int, error) {
	var h [256]int
	if !s.inited || s.image == nil {
		return h, fmt.Errorf("api: histogram before init: %w", ErrState)
	}
	k := engine.SortKey(key)
	if !knownKeys[k] {
		return h, fmt.Errorf("api: unknown sort key %q", key)
	}
	for _, v := range engine.ComputeKeys(s.image, k, false) {
		h[v]++
	}
	return h, nil
}

// CARule is one recommended cellular-automaton rule and what it looks like.
type CARule struct {
	Rule int
	Note string
}

// CARules lists the recommended Wolfram rules with their one-line notes, in the engine's order.
func CARules() []CARule {
	out := make([]CARule, 0, len(engine.RecommendedRules))
	for _, r := range engine.RecommendedRules {
		note, _ := engine.RuleNote(r)
		out = append(out, CARule{Rule: int(r), Note: note})
	}
	return out
}
