package api

import (
	"fmt"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/engine/patterns"
)

// PatternFamily is one family of generative patterns and its variants, for the panel's picker.
type PatternFamily struct {
	Name     string
	Note     string
	Variants []patterns.Variant
}

// PatternCatalog lists the pattern families the panel may offer, in the engine's order.
func PatternCatalog() []PatternFamily {
	fams := patterns.Catalog()
	out := make([]PatternFamily, len(fams))
	for i, f := range fams {
		out[i] = PatternFamily{Name: f.Name, Note: f.Note, Variants: f.Variants}
	}
	return out
}

// PatternPreviewW and PatternPreviewH are the fixed size of the pattern preview the Pro panel draws, the same
// canvas as the cellular rule preview.
const (
	PatternPreviewW = 320
	PatternPreviewH = 160
)

// PatternPreview draws what the recipe's pattern looks like on a small fixed canvas, as a 0/1 mask. It is stateless:
// no session, no picture, and it never touches a running sort, so the panel can ask on every knob change. Like the
// cellular preview it shows the pattern's texture, not the exact mask of a picture with a region map.
func PatternPreview(paramsJSON []byte) (mask []uint8, w, h int, err error) {
	p, err := engine.ParseParams(paramsJSON)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("api: pattern preview: %w", err)
	}
	mask, err = engine.PatternPreview(PatternPreviewW, PatternPreviewH, p)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("api: %w", err)
	}
	return mask, PatternPreviewW, PatternPreviewH, nil
}
