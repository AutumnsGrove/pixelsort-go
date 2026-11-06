package engine_test

import (
	"bytes"
	"fmt"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

func previewParams(edit func(*engine.Params)) engine.Params {
	p := engine.DefaultParams()
	p.Mode, p.Rule, p.Seed = engine.ModeCA, 30, 7
	if edit != nil {
		edit(&p)
	}
	return p
}

func TestCAPreviewIsAZeroOneMaskTheSizeAsked(t *testing.T) {
	m, err := engine.CAPreview(320, 160, previewParams(nil))
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 320*160 {
		t.Fatalf("len %d, want %d", len(m), 320*160)
	}
	var ones int
	for _, v := range m {
		if v > 1 {
			t.Fatalf("a mask holds only 0 and 1, got %d", v)
		}
		ones += int(v)
	}
	if ones == 0 || ones == len(m) {
		t.Fatalf("rule 30 should make both values, got %d ones of %d", ones, len(m))
	}
}

func TestCAPreviewIsDeterministic(t *testing.T) {
	a, _ := engine.CAPreview(200, 100, previewParams(nil))
	b, _ := engine.CAPreview(200, 100, previewParams(nil))
	if !bytes.Equal(a, b) {
		t.Fatal("the same arguments gave two different previews")
	}
}

// Image space is the simplest case to state independently: the rule's grid, one square per cell, in reading order.
func TestCAPreviewInImageSpaceIsTheRulesGridScaledToCells(t *testing.T) {
	const w, h = 320, 160
	p := previewParams(func(p *engine.Params) { p.Cell = 12 }) // per mille of the width
	got, err := engine.CAPreview(w, h, p)
	if err != nil {
		t.Fatal(err)
	}
	cellPx := max(1, (w*p.Cell+500)/1000)
	cw, ch := (w+cellPx-1)/cellPx, (h+cellPx-1)/cellPx
	want := engine.CAMapImage(w, h, cellPx, engine.CAGrid(cw, ch, uint8(p.Rule), p.CABoundary, p.Seed))
	if !bytes.Equal(got, want) {
		t.Fatal("the preview is not the rule's grid laid out cell by cell")
	}
}

func TestCAPreviewChangesWithTheRuleTheSpaceTheSeedAndTheBoundary(t *testing.T) {
	line := func(p *engine.Params) { p.CASpace, p.Angle = engine.CASpaceLine, 37 }
	base, _ := engine.CAPreview(320, 160, previewParams(nil))
	for name, edit := range map[string]func(*engine.Params){
		"rule":     func(p *engine.Params) { p.Rule = 110 },
		"space":    line,
		"seed":     func(p *engine.Params) { p.Seed = 8 },
		"boundary": func(p *engine.Params) { p.CABoundary = engine.CABoundaryWrap },
		"cell":     func(p *engine.Params) { p.Cell = 30 },
	} {
		other, err := engine.CAPreview(320, 160, previewParams(edit))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if bytes.Equal(base, other) {
			t.Errorf("changing the %s did not change the preview", name)
		}
	}
	// the sort angle only matters in line space
	a, _ := engine.CAPreview(320, 160, previewParams(func(p *engine.Params) { p.Angle = 37 }))
	if !bytes.Equal(base, a) {
		t.Error("in image space the sort angle must not change the preview")
	}
	l0, _ := engine.CAPreview(320, 160, previewParams(func(p *engine.Params) { p.CASpace, p.Angle = engine.CASpaceLine, 0 }))
	if !bytes.Equal(base, l0) {
		t.Error("line space along 0 degrees is the picture's own rows, so it must equal image space")
	}
	l37, _ := engine.CAPreview(320, 160, previewParams(line))
	l38, _ := engine.CAPreview(320, 160, previewParams(func(p *engine.Params) { p.CASpace, p.Angle = engine.CASpaceLine, 38 }))
	if bytes.Equal(l37, l38) {
		t.Error("in line space the pattern turns with the sort angle")
	}
}

func TestCAPreviewIgnoresTheIntervalMode(t *testing.T) {
	a, _ := engine.CAPreview(160, 80, previewParams(nil))
	b, _ := engine.CAPreview(160, 80, previewParams(func(p *engine.Params) { p.Mode = engine.ModeWave }))
	if !bytes.Equal(a, b) {
		t.Fatal("the panel shows the rule before the mode is switched to a cellular one, so the mode must not matter")
	}
}

func TestCAPreviewRefusesWhatItCannotDraw(t *testing.T) {
	for _, c := range []struct {
		name string
		w, h int
		edit func(*engine.Params)
	}{
		{"zero width", 0, 80, nil},
		{"negative height", 80, -1, nil},
		{"too big", engine.MaxCAPreview + 1, 80, nil},
		{"an impossible rule", 80, 80, func(p *engine.Params) { p.Rule = 300 }},
		{"an unknown space", 80, 80, func(p *engine.Params) { p.CASpace = "sideways" }},
	} {
		if _, err := engine.CAPreview(c.w, c.h, previewParams(c.edit)); err == nil {
			t.Errorf("%s: want an error", c.name)
		}
	}
}

func TestCAPreviewGoldens(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*engine.Params)
	}{
		{"capreview-30-image", nil},
		{"capreview-110-line-37", func(p *engine.Params) { p.Rule, p.CASpace, p.Angle = 110, engine.CASpaceLine, 37 }},
		{"capreview-90-wrap-image", func(p *engine.Params) { p.Rule, p.CABoundary, p.Cell = 90, engine.CABoundaryWrap, 20 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, err := engine.CAPreview(320, 160, previewParams(tc.edit))
			if err != nil {
				t.Fatal(err)
			}
			testutil.Golden(t, tc.name, m)
		})
	}
}

// Every recommended rule can be previewed in both spaces (the panel lists them all).
func TestCAPreviewWorksForEveryRecommendedRule(t *testing.T) {
	for _, r := range engine.RecommendedRules {
		for _, space := range []string{engine.CASpaceImage, engine.CASpaceLine} {
			t.Run(fmt.Sprintf("%d-%s", r, space), func(t *testing.T) {
				if _, err := engine.CAPreview(160, 80, previewParams(func(p *engine.Params) { p.Rule, p.CASpace, p.Angle = int(r), space, 20 })); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}
