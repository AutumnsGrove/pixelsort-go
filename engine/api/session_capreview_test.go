package api_test

import (
	"bytes"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/api"
)

func preview(t *testing.T, params string, rule int) []uint8 {
	t.Helper()
	m, w, h, err := api.CARulePreview([]byte(params), rule)
	if err != nil {
		t.Fatalf("rule %d with %s: %v", rule, params, err)
	}
	if w != api.CAPreviewW || h != api.CAPreviewH || len(m) != w*h {
		t.Fatalf("got %dx%d with %d bytes", w, h, len(m))
	}
	return m
}

func TestCARulePreviewUsesTheRecipeWithTheRuleSwapped(t *testing.T) {
	const recipe = `{"mode":"ca","rule":110,"caSpace":"image","seed":5}`
	m30, m110 := preview(t, recipe, 30), preview(t, recipe, 110)
	if bytes.Equal(m30, m110) {
		t.Fatal("two rules gave the same preview")
	}
	if !bytes.Equal(m30, preview(t, recipe, 30)) {
		t.Fatal("not deterministic")
	}
	// asking for the recipe's own rule is the same as naming it
	if !bytes.Equal(m110, preview(t, `{"mode":"ca","rule":30,"caSpace":"image","seed":5}`, 110)) {
		t.Fatal("the rule in the recipe must not matter: the rule argument decides")
	}
}

func TestCARulePreviewFollowsTheSpaceTheAngleAndTheCell(t *testing.T) {
	img := preview(t, `{"caSpace":"image","angle":37,"seed":5}`, 30)
	line := preview(t, `{"caSpace":"line","angle":37,"seed":5}`, 30)
	if bytes.Equal(img, line) {
		t.Fatal("image and line space looked the same at 37 degrees")
	}
	if bytes.Equal(line, preview(t, `{"caSpace":"line","angle":50,"seed":5}`, 30)) {
		t.Fatal("line space should turn with the angle")
	}
	if bytes.Equal(img, preview(t, `{"caSpace":"image","angle":37,"seed":5,"cell":40}`, 30)) {
		t.Fatal("a bigger cell should change the picture")
	}
}

func TestCARulePreviewNeedsNeitherASessionNorAPicture(t *testing.T) {
	// an empty recipe is the default recipe
	if len(preview(t, `{}`, 30)) == 0 {
		t.Fatal("empty")
	}
}

func TestCARulePreviewRefusesBadInput(t *testing.T) {
	for _, rule := range []int{-1, 256, 9999} {
		if _, _, _, err := api.CARulePreview([]byte(`{}`), rule); err == nil {
			t.Errorf("rule %d should be refused", rule)
		}
	}
	for _, bad := range []string{`not json`, `{"caSpace":"sideways"}`, `{"nope":1}`, `[]`} {
		if _, _, _, err := api.CARulePreview([]byte(bad), 30); err == nil {
			t.Errorf("recipe %q should be refused", bad)
		}
	}
	if _, _, _, err := api.CARulePreview([]byte(`{}`), 0); err != nil {
		t.Errorf("rule 0 is a real rule: %v", err)
	}
}
