package api_test

import (
	"bytes"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/api"
)

func TestPatternCatalogNamesFourFamiliesWithNotes(t *testing.T) {
	fams := api.PatternCatalog()
	if len(fams) != 4 {
		t.Fatalf("%d families, want 4", len(fams))
	}
	for _, f := range fams {
		if f.Name == "" || f.Note == "" {
			t.Errorf("family %+v has no name or note", f)
		}
		if len(f.Variants) == 0 {
			t.Errorf("family %q has no variants", f.Name)
		}
		for _, v := range f.Variants {
			if v.Name == "" || v.Note == "" {
				t.Errorf("%s has a variant with no name or note: %+v", f.Name, v)
			}
		}
	}
}

func TestPatternPreviewIsDeterministicAndBinary(t *testing.T) {
	const recipe = `{"mode":"pattern","pattern":"truchet","patternVariant":"arc","seed":5}`
	a, w, h, err := api.PatternPreview([]byte(recipe))
	if err != nil {
		t.Fatal(err)
	}
	if w != api.PatternPreviewW || h != api.PatternPreviewH || len(a) != w*h {
		t.Fatalf("got %dx%d with %d bytes", w, h, len(a))
	}
	b, _, _, _ := api.PatternPreview([]byte(recipe))
	if !bytes.Equal(a, b) {
		t.Fatal("not deterministic")
	}
	for i, v := range a {
		if v > 1 {
			t.Fatalf("byte %d is %d", i, v)
		}
	}
}

func TestPatternPreviewFollowsTheKnobs(t *testing.T) {
	preview := func(recipe string) []byte {
		m, _, _, err := api.PatternPreview([]byte(recipe))
		if err != nil {
			t.Fatalf("%s: %v", recipe, err)
		}
		return m
	}
	base := preview(`{"pattern":"truchet","patternVariant":"arc","seed":5,"patternCell":60}`)
	if bytes.Equal(base, preview(`{"pattern":"truchet","patternVariant":"strand","seed":5,"patternCell":60}`)) {
		t.Error("the variant did not change the preview")
	}
	if bytes.Equal(base, preview(`{"pattern":"truchet","patternVariant":"arc","seed":5,"patternCell":120}`)) {
		t.Error("the cell size did not change the preview")
	}
	if bytes.Equal(base, preview(`{"pattern":"truchet","patternVariant":"arc","seed":6,"patternCell":60}`)) {
		t.Error("the seed did not change the preview")
	}
	if bytes.Equal(base, preview(`{"pattern":"truchet","patternVariant":"arc","seed":5,"patternCell":60,"patternInvert":true}`)) {
		t.Error("invert did not change the preview")
	}
	img := preview(`{"pattern":"radial","patternVariant":"spiral","seed":5,"patternCell":40,"angle":0,"caSpace":"image"}`)
	line := preview(`{"pattern":"radial","patternVariant":"spiral","seed":5,"patternCell":40,"angle":37,"caSpace":"line"}`)
	if bytes.Equal(img, line) {
		t.Error("line space did not turn with the angle")
	}
}

func TestPatternPreviewRefusesBadRecipes(t *testing.T) {
	for _, bad := range []string{
		`not json`, `{"pattern":"nope"}`, `{"patternVariant":"nope"}`, `{"patternCell":0}`,
		`{"patternThickness":501}`, `{"patternRotate":360}`, `{"patternDetail":17}`,
		`{"pattern":"","patternOverlay":true}`, `{"nope":1}`, `[]`,
	} {
		if _, _, _, err := api.PatternPreview([]byte(bad)); err == nil {
			t.Errorf("recipe %q should be refused", bad)
		}
	}
}
