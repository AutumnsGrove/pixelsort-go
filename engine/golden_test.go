package engine_test

import (
	"encoding/json"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// goldenCase is one fixed recipe whose output hash must never change by accident.
type goldenCase struct {
	name    string
	w, h    int
	params  engine.Params
	options *engine.Options
}

// goldenRecipes covers every interval mode, both directions, a region map, and the degenerate one-pixel-wide shapes.
func goldenRecipes() []goldenCase {
	with := func(edit func(*engine.Params)) engine.Params {
		p := engine.DefaultParams()
		edit(&p)
		return p
	}
	hue := engine.KeyHue
	steep := 100
	checker := testutil.GridCells(97, 61, 16)
	classOf := testutil.ClassPattern(maxCells(checker), "checker", 1)
	return []goldenCase{
		{name: "random-0", w: 97, h: 61, params: with(func(p *engine.Params) { p.Seed = 1 })},
		{name: "random-45", w: 97, h: 61, params: with(func(p *engine.Params) { p.Angle, p.Length, p.Seed = 45, 60, 2 })},
		{name: "random-217", w: 97, h: 61, params: with(func(p *engine.Params) { p.Angle, p.Key, p.Reverse, p.Seed = 217, engine.KeyHue, true, 3 })},
		{name: "wave-30", w: 97, h: 61, params: with(func(p *engine.Params) { p.Mode, p.Angle, p.WaveAmp, p.Seed = engine.ModeWave, 30, 70, 4 })},
		{name: "threshold-90", w: 97, h: 61, params: with(func(p *engine.Params) { p.Mode, p.Angle, p.Lo, p.Hi, p.Seed = engine.ModeThreshold, 90, 60, 200, 5 })},
		{name: "edges-0", w: 97, h: 61, params: with(func(p *engine.Params) { p.Mode, p.Edge, p.Seed = engine.ModeEdges, 30, 6 })},
		{name: "none-270", w: 61, h: 97, params: with(func(p *engine.Params) { p.Mode, p.Angle, p.Key, p.Seed = engine.ModeNone, 270, engine.KeySaturation, 7 })},
		{
			name: "regions-checker", w: 97, h: 61, params: with(func(p *engine.Params) { p.Seed = 8 }),
			options: &engine.Options{Regions: &engine.Regions{
				Labels: checker, ClassOf: classOf,
				Defs: []engine.ClassDef{{}, {Frozen: true}, {Angle: &steep, Key: &hue}},
			}},
		},
		{name: "tiny-1x40", w: 1, h: 40, params: with(func(p *engine.Params) { p.Seed = 9 })},
		{name: "tiny-40x1", w: 40, h: 1, params: with(func(p *engine.Params) { p.Seed = 10 })},
	}
}

// TestGolden pins the engine's exact output. A changed hash is a behaviour change: bump EngineVersion in the same
// commit and say why, or find the bug. The same files are checked on arm64, amd64 and (from phase 2) WASM.
func TestGolden(t *testing.T) {
	if testutil.Updating() {
		writeRecipes(t)
	}
	for _, tc := range goldenRecipes() {
		t.Run(tc.name, func(t *testing.T) {
			im := testutil.Gradient(tc.w, tc.h, 3)
			pl, err := engine.NewPlan(im, tc.params, tc.options)
			if err != nil {
				t.Fatalf("NewPlan: %v", err)
			}
			out := pl.Sort()
			testutil.Golden(t, tc.name, out.RGBA())
			if testutil.Updating() {
				writePNG(t, tc.name, out)
			}
		})
	}
}

// TestGoldenCoversEveryMode keeps the table honest: a mode that has no case would be unpinned.
func TestGoldenCoversEveryMode(t *testing.T) {
	seen := map[engine.IntervalMode]bool{}
	regions := false
	for _, tc := range goldenRecipes() {
		seen[tc.params.Mode] = true
		if tc.options != nil && tc.options.Regions != nil {
			regions = true
		}
	}
	for _, mode := range []engine.IntervalMode{engine.ModeRandom, engine.ModeWave, engine.ModeThreshold, engine.ModeEdges, engine.ModeNone} {
		if !seen[mode] {
			t.Errorf("no golden uses mode %q", mode)
		}
	}
	if !regions {
		t.Error("no golden uses a region map")
	}
}

// writePNG saves a recipe's output so a person can look at what the hashes are pinning. It writes into build/,
// which is never committed.
func writePNG(t *testing.T, name string, im *engine.Image) {
	t.Helper()
	dir := filepath.Join("build", "golden-preview")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatalf("preview: %v", err)
	}
	rgba := im.RGBA()
	// The engine's images are alpha 255 everywhere, which is what a non-premultiplied NRGBA wants.
	nrgba := &image.NRGBA{Pix: rgba, Stride: 4 * im.W, Rect: image.Rect(0, 0, im.W, im.H)}
	f, err := os.Create(filepath.Join(dir, name+".png")) //nolint:gosec // a fixed path under the ignored build dir
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	defer func() {
		if err := f.Close(); err != nil {
			t.Errorf("preview: %v", err)
		}
	}()
	if err := png.Encode(f, nrgba); err != nil {
		t.Fatalf("preview: %v", err)
	}
}

// recipeFile is one entry of recipes.json: enough for another program (the WASM check in Node) to rebuild the
// input and the recipe and compare its output hash with the golden.
type recipeFile struct {
	Name         string         `json:"name"`
	W            int            `json:"w"`
	H            int            `json:"h"`
	GradientSeed uint32         `json:"gradientSeed"`
	Params       engine.Params  `json:"params"`
	Regions      *recipeRegions `json:"regions,omitempty"`
	SHA256       string         `json:"sha256"`
}

// recipeRegions describes the checker grid used by the region golden; the JS side rebuilds it with the same
// integer formulas as testutil.GridCells and testutil.ClassPattern("checker").
type recipeRegions struct {
	CellSize int               `json:"cellSize"`
	Pattern  string            `json:"pattern"`
	Defs     []engine.ClassDef `json:"defs"`
}

// writeRecipes regenerates testdata/golden/recipes.json from the table above. It runs only with -update.
func writeRecipes(t *testing.T) {
	t.Helper()
	var out []recipeFile
	for _, tc := range goldenRecipes() {
		raw, err := os.ReadFile(filepath.Join("testdata", "golden", tc.name+".sha256"))
		sum := ""
		if err == nil {
			sum = string(raw[:len(raw)-1])
		}
		rf := recipeFile{Name: tc.name, W: tc.w, H: tc.h, GradientSeed: 3, Params: tc.params, SHA256: sum}
		if tc.options != nil && tc.options.Regions != nil {
			rf.Regions = &recipeRegions{CellSize: 16, Pattern: "checker", Defs: tc.options.Regions.Defs}
		}
		out = append(out, rf)
	}
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatalf("recipes: %v", err)
	}
	if err := os.WriteFile(filepath.Join("testdata", "golden", "recipes.json"), append(data, '\n'), 0o600); err != nil {
		t.Fatalf("recipes: %v", err)
	}
}
