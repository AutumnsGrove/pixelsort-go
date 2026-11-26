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
	const spec = `{"shape":"pattern","size":90,"gap":8,"rotate":0,"seed":5,"pattern":"checker","family":"truchet","variant":"arc","detail":5}`
	a, w, h, err := api.PatternPreview([]byte(spec))
	if err != nil {
		t.Fatal(err)
	}
	if w != api.PatternPreviewW || h != api.PatternPreviewH || len(a) != w*h {
		t.Fatalf("got %dx%d with %d bytes", w, h, len(a))
	}
	b, _, _, _ := api.PatternPreview([]byte(spec))
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
	preview := func(spec string) []byte {
		m, _, _, err := api.PatternPreview([]byte(spec))
		if err != nil {
			t.Fatalf("%s: %v", spec, err)
		}
		return m
	}
	const base = `{"shape":"pattern","size":90,"gap":8,"rotate":0,"seed":5,"pattern":"checker","family":"truchet","variant":"arc","detail":5}`
	plain := preview(base)
	for name, spec := range map[string]string{
		"variant": `{"shape":"pattern","size":90,"gap":8,"rotate":0,"seed":5,"pattern":"checker","family":"truchet","variant":"strand","detail":5}`,
		"family":  `{"shape":"pattern","size":90,"gap":8,"rotate":0,"seed":5,"pattern":"checker","family":"radial","variant":"spiral","detail":5}`,
		"size":    `{"shape":"pattern","size":180,"gap":8,"rotate":0,"seed":5,"pattern":"checker","family":"truchet","variant":"arc","detail":5}`,
		"gap":     `{"shape":"pattern","size":90,"gap":20,"rotate":0,"seed":5,"pattern":"checker","family":"truchet","variant":"arc","detail":5}`,
		"rotate":  `{"shape":"pattern","size":90,"gap":8,"rotate":37,"seed":5,"pattern":"checker","family":"truchet","variant":"arc","detail":5}`,
		"seed":    `{"shape":"pattern","size":90,"gap":8,"rotate":0,"seed":6,"pattern":"checker","family":"truchet","variant":"arc","detail":5}`,
		"invert":  `{"shape":"pattern","size":90,"gap":8,"rotate":0,"seed":5,"pattern":"checker","family":"truchet","variant":"arc","detail":5,"invert":true}`,
	} {
		if bytes.Equal(plain, preview(spec)) {
			t.Errorf("the %s did not change the preview", name)
		}
	}
}

func TestPatternPreviewRefusesBadSpecs(t *testing.T) {
	for name, bad := range map[string]string{
		"not json":       `not json`,
		"empty":          `{}`,
		"unknown field":  `{"shape":"pattern","size":90,"gap":8,"seed":5,"pattern":"checker","family":"truchet","variant":"arc","detail":5,"nope":1}`,
		"a square":       `{"shape":"square","size":90,"gap":8,"seed":5,"pattern":"checker"}`,
		"unknown family": `{"shape":"pattern","size":90,"gap":8,"seed":5,"pattern":"checker","family":"nope","variant":"arc","detail":5}`,
		"no line":        `{"shape":"pattern","size":90,"gap":0,"seed":5,"pattern":"checker","family":"truchet","variant":"arc","detail":5}`,
	} {
		if _, _, _, err := api.PatternPreview([]byte(bad)); err == nil {
			t.Errorf("%s should be refused", name)
		}
	}
}
