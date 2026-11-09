package engine

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/AutumnsGrove/pixelsort-go/engine/patterns"
)

// IntervalMode is how a line is cut into sortable intervals (PLAN.md 3.3, decision E7).
type IntervalMode string

// The interval modes. ca and ca-edges are accepted by Params but only built in phase 4.
const (
	ModeRandom       IntervalMode = "random"
	ModeWave         IntervalMode = "wave"
	ModeThreshold    IntervalMode = "threshold"
	ModeEdges        IntervalMode = "edges"
	ModeCA           IntervalMode = "ca"
	ModeCAEdges      IntervalMode = "ca-edges"
	ModePattern      IntervalMode = "pattern"
	ModePatternEdges IntervalMode = "pattern-edges"
	ModeNone         IntervalMode = "none"
)

// SortKey names the per-pixel value pixels are sorted by (decision E2).
type SortKey string

// The sort keys.
const (
	KeyLuma       SortKey = "luma"
	KeyValue      SortKey = "value"
	KeyIntensity  SortKey = "intensity"
	KeyMinimum    SortKey = "minimum"
	KeyHue        SortKey = "hue"
	KeySaturation SortKey = "saturation"
	KeyRed        SortKey = "red"
	KeyGreen      SortKey = "green"
	KeyBlue       SortKey = "blue"
	KeyAlpha      SortKey = "alpha"
)

// Algo names the visual sorting algorithm an interval uses (phase 3). reveal is not a sort: it finishes whole
// intervals a chunk at a time.
type Algo string

// The sorting algorithms.
const (
	AlgoOddEven   Algo = "oddeven"
	AlgoInsertion Algo = "insertion"
	AlgoMerge     Algo = "merge"
	AlgoReveal    Algo = "reveal"
)

// Where a cellular automaton's mask lives (phase 4). Image space means the pattern is fixed to the picture and
// gets sheared by the sort lines; line space means it is generated along each line, so it rotates with them.
const (
	CASpaceImage = "image"
	CASpaceLine  = "line"
)

// How a cellular automaton treats the ends of a row (phase 4).
const (
	CABoundaryRandom = "random"
	CABoundaryWrap   = "wrap"
	CABoundaryFixed  = "fixed"
)

// Params is the recipe: one JSON-serialisable struct that, with the seed and EngineVersion, reproduces a result
// exactly (PLAN.md 3.1). Spatial fields are per mille of the image width so a preview and an export agree.
type Params struct {
	Mode             IntervalMode `json:"mode"`
	Key              SortKey      `json:"key"`
	Reverse          bool         `json:"reverse"`    // descending
	Angle            int          `json:"angle"`      // whole degrees 0..359 (decision E3)
	Length           int          `json:"length"`     // mean interval length, per mille of image width, 1..1000
	Randomness       int          `json:"randomness"` // percent of intervals left unsorted, 0..100
	WaveAmp          int          `json:"waveAmp"`    // 0..100
	WavePeriod       int          `json:"wavePeriod"` // per mille of width, 0 = automatic, else 1..1000
	Lo               int          `json:"lo"`         // threshold band, 0..255, Lo <= Hi
	Hi               int          `json:"hi"`
	ThresholdKey     SortKey      `json:"thresholdKey"`     // which value the band applies to
	Edge             int          `json:"edge"`             // a pixel is an edge when its laplacian is greater than this
	Rule             int          `json:"rule"`             // Wolfram rule, 0..255 (phase 4)
	Cell             int          `json:"cell"`             // CA cell size, per mille of width, 1..1000 (phase 4)
	CASpace          string       `json:"caSpace"`          // CASpaceImage or CASpaceLine (phase 4)
	CABoundary       string       `json:"caBoundary"`       // CABoundaryRandom, CABoundaryWrap or CABoundaryFixed
	Pattern          string       `json:"pattern"`          // family from engine/patterns; "" = none
	PatternVariant   string       `json:"patternVariant"`   // variant of that family; "" = the family's first
	PatternCell      int          `json:"patternCell"`      // per mille of width, 1..1000
	PatternThickness int          `json:"patternThickness"` // per mille of width, 1..500
	PatternRotate    int          `json:"patternRotate"`    // degrees 0..359
	PatternDetail    int          `json:"patternDetail"`    // arms, spokes or gaps, 1..16
	PatternInvert    bool         `json:"patternInvert"`
	PatternOverlay   bool         `json:"patternOverlay"` // freeze the pattern instead of cutting intervals at it
	Algo             Algo         `json:"algo"`
	Seed             uint32       `json:"seed"`
}

// ClassDef is one region class's overrides of Params. A nil field inherits the global value (decision E10).
type ClassDef struct {
	Frozen           bool          `json:"frozen,omitempty"`
	Angle            *int          `json:"angle,omitempty"`
	Key              *SortKey      `json:"key,omitempty"`
	Reverse          *bool         `json:"reverse,omitempty"`
	Mode             *IntervalMode `json:"mode,omitempty"`
	Length           *int          `json:"length,omitempty"`
	Randomness       *int          `json:"randomness,omitempty"`
	Lo               *int          `json:"lo,omitempty"`
	Hi               *int          `json:"hi,omitempty"`
	Edge             *int          `json:"edge,omitempty"`
	Rule             *int          `json:"rule,omitempty"`
	Cell             *int          `json:"cell,omitempty"`
	Pattern          *string       `json:"pattern,omitempty"`
	PatternVariant   *string       `json:"patternVariant,omitempty"`
	PatternCell      *int          `json:"patternCell,omitempty"`
	PatternThickness *int          `json:"patternThickness,omitempty"`
	PatternRotate    *int          `json:"patternRotate,omitempty"`
	PatternDetail    *int          `json:"patternDetail,omitempty"`
	PatternInvert    *bool         `json:"patternInvert,omitempty"`
	PatternOverlay   *bool         `json:"patternOverlay,omitempty"`
	Algo             *Algo         `json:"algo,omitempty"`
}

// ErrInvalidParams means a recipe is out of range or names something that does not exist. Validate wraps it with
// the field and the value, so an error can be shown to a person.
var ErrInvalidParams = errors.New("engine: invalid params")

// validModes, validKeys and validAlgos are read-only lookup sets for validation.
var (
	validModes = map[IntervalMode]bool{ModeRandom: true, ModeWave: true, ModeThreshold: true, ModeEdges: true,
		ModeCA: true, ModeCAEdges: true, ModePattern: true, ModePatternEdges: true, ModeNone: true}
	validKeys = map[SortKey]bool{KeyLuma: true, KeyValue: true, KeyIntensity: true, KeyMinimum: true, KeyHue: true,
		KeySaturation: true, KeyRed: true, KeyGreen: true, KeyBlue: true, KeyAlpha: true}
	validAlgos = map[Algo]bool{AlgoOddEven: true, AlgoInsertion: true, AlgoMerge: true, AlgoReveal: true}
)

// DefaultParams is the recipe a new sort starts from.
func DefaultParams() Params {
	return Params{
		Mode:             ModeRandom,
		Key:              KeyLuma,
		Angle:            0,
		Length:           83,
		Randomness:       10,
		WaveAmp:          70,
		WavePeriod:       0,
		Lo:               51,
		Hi:               209,
		ThresholdKey:     KeyLuma,
		Edge:             26,
		Rule:             110,
		Cell:             8,
		CASpace:          CASpaceImage,
		CABoundary:       CABoundaryRandom,
		Pattern:          "truchet",
		PatternVariant:   "arc",
		PatternCell:      60,
		PatternThickness: 8,
		PatternRotate:    0,
		PatternDetail:    5,
		Algo:             AlgoOddEven,
		Seed:             7,
	}
}

// invalidParams builds an error that names the offending field, keeps the value visible, and wraps
// ErrInvalidParams so callers can tell a bad recipe from any other failure.
func invalidParams(format string, args ...any) error {
	return fmt.Errorf("engine: params: "+format+": %w", append(args, ErrInvalidParams)...)
}

// Validate reports the first field that is out of range or names something unknown.
func (p Params) Validate() error {
	switch {
	case !validModes[p.Mode]:
		return invalidParams("mode %q", p.Mode)
	case !validKeys[p.Key]:
		return invalidParams("key %q", p.Key)
	case !validKeys[p.ThresholdKey]:
		return invalidParams("thresholdKey %q", p.ThresholdKey)
	case !validAlgos[p.Algo]:
		return invalidParams("algo %q", p.Algo)
	case p.Angle < 0 || p.Angle > 359:
		return invalidParams("angle %d outside 0..359", p.Angle)
	case p.Length < 1 || p.Length > 1000:
		return invalidParams("length %d outside 1..1000", p.Length)
	case p.Randomness < 0 || p.Randomness > 100:
		return invalidParams("randomness %d outside 0..100", p.Randomness)
	case p.WaveAmp < 0 || p.WaveAmp > 100:
		return invalidParams("waveAmp %d outside 0..100", p.WaveAmp)
	case p.WavePeriod < 0 || p.WavePeriod > 1000:
		return invalidParams("wavePeriod %d outside 0..1000", p.WavePeriod)
	case p.Lo < 0 || p.Lo > 255:
		return invalidParams("lo %d outside 0..255", p.Lo)
	case p.Hi < 0 || p.Hi > 255:
		return invalidParams("hi %d outside 0..255", p.Hi)
	case p.Lo > p.Hi:
		return invalidParams("lo %d is above hi %d", p.Lo, p.Hi)
	case p.Edge < 0 || p.Edge > 255:
		return invalidParams("edge %d outside 0..255", p.Edge)
	case p.Rule < 0 || p.Rule > 255:
		return invalidParams("rule %d outside 0..255", p.Rule)
	case p.Cell < 1 || p.Cell > 1000:
		return invalidParams("cell %d outside 1..1000", p.Cell)
	case p.CASpace != CASpaceImage && p.CASpace != CASpaceLine:
		return invalidParams("caSpace %q", p.CASpace)
	case p.CABoundary != CABoundaryRandom && p.CABoundary != CABoundaryWrap && p.CABoundary != CABoundaryFixed:
		return invalidParams("caBoundary %q", p.CABoundary)
	}
	if p.Pattern == "" {
		if p.Mode == ModePattern || p.Mode == ModePatternEdges || p.PatternOverlay {
			return invalidParams("mode %q needs a pattern", p.Mode)
		}
		return nil
	}
	if err := patterns.Validate(p.patternSpec(1)); err != nil {
		return invalidParams("pattern: %v", err)
	}
	return nil
}

// patternSpec is the patterns.Spec a recipe asks for. width is the reference width for the per-mille sizes: a
// line-space mask passes the picture's width, not the narrow canvas it is drawn on.
func (p Params) patternSpec(width int) patterns.Spec {
	return patterns.Spec{
		Family: p.Pattern, Variant: p.PatternVariant, Seed: p.Seed,
		Cell: p.PatternCell, Thickness: p.PatternThickness, Rotate: p.PatternRotate,
		Detail: p.PatternDetail, Invert: p.PatternInvert, Width: width,
	}
}

// ParseParams decodes a recipe on top of DefaultParams, so a partial recipe keeps the defaults for every field it
// does not mention. Unknown fields and trailing data are rejected: a typo in a saved recipe should not be ignored.
func ParseParams(data []byte) (Params, error) {
	p := DefaultParams()
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		return Params{}, fmt.Errorf("engine: parse params: %w", err)
	}
	// Only end of input may follow the object. A decoder reports garbage such as "x" or "}" as an error too, so
	// "no error" is not the test: io.EOF is.
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return Params{}, fmt.Errorf("engine: parse params: trailing data after the recipe: %w", ErrInvalidParams)
	}
	if err := p.Validate(); err != nil {
		return Params{}, err
	}
	return p, nil
}

// With returns the params this class actually sorts with: every field the class overrides is replaced, the rest
// inherit. The result is not validated; the caller validates what it builds.
func (p Params) With(c ClassDef) Params {
	if c.Angle != nil {
		p.Angle = *c.Angle
	}
	if c.Key != nil {
		p.Key = *c.Key
	}
	if c.Reverse != nil {
		p.Reverse = *c.Reverse
	}
	if c.Mode != nil {
		p.Mode = *c.Mode
	}
	if c.Length != nil {
		p.Length = *c.Length
	}
	if c.Randomness != nil {
		p.Randomness = *c.Randomness
	}
	if c.Lo != nil {
		p.Lo = *c.Lo
	}
	if c.Hi != nil {
		p.Hi = *c.Hi
	}
	if c.Edge != nil {
		p.Edge = *c.Edge
	}
	if c.Rule != nil {
		p.Rule = *c.Rule
	}
	if c.Cell != nil {
		p.Cell = *c.Cell
	}
	if c.Pattern != nil {
		p.Pattern = *c.Pattern
	}
	if c.PatternVariant != nil {
		p.PatternVariant = *c.PatternVariant
	}
	if c.PatternCell != nil {
		p.PatternCell = *c.PatternCell
	}
	if c.PatternThickness != nil {
		p.PatternThickness = *c.PatternThickness
	}
	if c.PatternRotate != nil {
		p.PatternRotate = *c.PatternRotate
	}
	if c.PatternDetail != nil {
		p.PatternDetail = *c.PatternDetail
	}
	if c.PatternInvert != nil {
		p.PatternInvert = *c.PatternInvert
	}
	if c.PatternOverlay != nil {
		p.PatternOverlay = *c.PatternOverlay
	}
	if c.Algo != nil {
		p.Algo = *c.Algo
	}
	return p
}
