package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeTestPNG creates w x h image where each row is reds (one red value per column).
func writeTestPNG(t *testing.T, path string, rows [][]uint8) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, len(rows[0]), len(rows)))
	for y, row := range rows {
		for x, r := range row {
			img.SetNRGBA(x, y, color.NRGBA{R: r, G: 0, B: 0, A: 255})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func readPNG(t *testing.T, path string) image.Image {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := f.Close(); err != nil {
			t.Errorf("close: %v", err)
		}
	}()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func TestRenderSortsEachRow(t *testing.T) {
	dir := t.TempDir()
	in, recipe, out := filepath.Join(dir, "in.png"), filepath.Join(dir, "recipe.json"), filepath.Join(dir, "out.png")
	writeTestPNG(t, in, [][]uint8{{30, 10, 20, 50, 40}, {90, 70, 80, 60, 100}})
	if err := os.WriteFile(recipe, []byte(`{"mode":"none","key":"red","randomness":0}`), 0o600); err != nil {
		t.Fatal(err)
	}

	root := newRoot()
	var stdout bytes.Buffer
	root.SetOut(&stdout)
	root.SetArgs([]string{"render", "--in", in, "--recipe", recipe, "--out", out})
	if err := root.Execute(); err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(stdout.String(), "intervals") {
		t.Errorf("stats not printed: %q", stdout.String())
	}

	img := readPNG(t, out)
	if img.Bounds().Dx() != 5 || img.Bounds().Dy() != 2 {
		t.Fatalf("output is %v, want 5x2", img.Bounds())
	}
	for y := 0; y < 2; y++ {
		prev := -1
		for x := 0; x < 5; x++ {
			r, _, _, _ := img.At(x, y).RGBA()
			if int(r>>8) < prev {
				t.Fatalf("row %d is not sorted: %d after %d", y, r>>8, prev)
			}
			prev = int(r >> 8)
		}
	}
}

func TestRenderMaskedPixelDoesNotMove(t *testing.T) {
	dir := t.TempDir()
	in, recipe, out, mask := filepath.Join(dir, "in.png"), filepath.Join(dir, "recipe.json"),
		filepath.Join(dir, "out.png"), filepath.Join(dir, "mask.png")
	writeTestPNG(t, in, [][]uint8{{30, 10, 20}})
	if err := os.WriteFile(recipe, []byte(`{"mode":"none","key":"red","randomness":0}`), 0o600); err != nil {
		t.Fatal(err)
	}
	// The mask paints the first pixel white, so it stays at 30 and only the rest sorts.
	writeTestPNG(t, mask, [][]uint8{{255, 0, 0}})

	root := newRoot()
	root.SetOut(&bytes.Buffer{})
	root.SetArgs([]string{"render", "--in", in, "--recipe", recipe, "--out", out, "--mask", mask})
	if err := root.Execute(); err != nil {
		t.Fatalf("render: %v", err)
	}
	img := readPNG(t, out)
	var reds []int
	for x := 0; x < 3; x++ {
		r, _, _, _ := img.At(x, 0).RGBA()
		reds = append(reds, int(r>>8))
	}
	if reds[0] != 30 {
		t.Fatalf("masked pixel moved: row = %v", reds)
	}
}

func TestRenderErrors(t *testing.T) {
	dir := t.TempDir()
	in, recipe, out := filepath.Join(dir, "in.png"), filepath.Join(dir, "recipe.json"), filepath.Join(dir, "out.png")
	writeTestPNG(t, in, [][]uint8{{30, 10, 20}})
	badRecipe := filepath.Join(dir, "bad.json")
	if err := os.WriteFile(badRecipe, []byte(`{"angle": 400}`), 0o600); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		args []string
		want string
	}{
		{"missing input file", []string{"render", "--in", filepath.Join(dir, "nope.png"), "--recipe", recipe, "--out", out}, "nope.png"},
		{"missing recipe file", []string{"render", "--in", in, "--recipe", filepath.Join(dir, "nope.json"), "--out", out}, "nope.json"},
		{"invalid recipe", []string{"render", "--in", in, "--recipe", badRecipe, "--out", out}, "angle"},
		{"unknown flag", []string{"render", "--nope"}, "nope"},
		{"no flags", []string{"render"}, "--in"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := newRoot()
			root.SetOut(&bytes.Buffer{})
			root.SetErr(&bytes.Buffer{})
			root.SetArgs(tc.args)
			err := root.Execute()
			if err == nil {
				t.Fatal("no error")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error %q does not mention %q", err, tc.want)
			}
		})
	}
}
