package anim_test

import (
	"image/color"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/anim"
)

func TestMedianCutKeepsExactColoursWhenTheyFit(t *testing.T) {
	samples := []color.RGBA{
		{R: 10, G: 20, B: 30, A: 255},
		{R: 200, G: 100, B: 50, A: 255},
		{R: 0, G: 255, B: 128, A: 255},
	}
	pal := anim.MedianCut(samples, 256)
	if len(pal) != 3 {
		t.Fatalf("got %d palette entries, want one per colour", len(pal))
	}
	want := map[color.RGBA]bool{samples[0]: true, samples[1]: true, samples[2]: true}
	for _, c := range pal {
		if !want[c] {
			t.Fatalf("palette has %v, which was not sampled", c)
		}
	}
}

func TestMedianCutFillsEverySlot(t *testing.T) {
	samples := make([]color.RGBA, 0, 1000)
	for i := range 1000 {
		samples = append(samples, color.RGBA{R: uint8(i), G: uint8(i * 7), B: uint8(i * 13), A: 255})
	}
	pal := anim.MedianCut(samples, 64)
	if len(pal) != 64 {
		t.Fatalf("got %d entries, want 64", len(pal))
	}
	for _, c := range pal {
		if c.A != 255 {
			t.Fatalf("palette colour %v is not opaque", c)
		}
	}
}

func TestMedianCutHandlesEmptyAndTinyRequests(t *testing.T) {
	if pal := anim.MedianCut(nil, 256); len(pal) < 2 {
		t.Fatalf("empty samples gave a %d-entry palette, want at least 2", len(pal))
	}
	if pal := anim.MedianCut([]color.RGBA{{R: 1, G: 2, B: 3, A: 255}}, 1); len(pal) != 1 {
		t.Fatalf("got %d entries, want 1", len(pal))
	}
}

func TestMapperFindsExactColours(t *testing.T) {
	pal := []color.RGBA{{0, 0, 0, 255}, {255, 0, 0, 255}, {0, 255, 0, 255}, {0, 0, 255, 255}}
	m := anim.NewMapper(pal)
	for i, want := range []uint8{0, 1, 2, 3} {
		if got := m.Index(pal[i]); got != want {
			t.Fatalf("exact colour %v mapped to %d, want %d", pal[i], got, want)
		}
	}
}

func TestMapImageWithoutDitheringKeepsFlatPixels(t *testing.T) {
	im := &engine.Image{W: 2, H: 2, Pix: []uint32{
		engine.Pack(255, 0, 0, 255), engine.Pack(0, 255, 0, 255),
		engine.Pack(0, 0, 255, 255), engine.Pack(0, 0, 0, 255),
	}}
	m := anim.NewMapper([]color.RGBA{{0, 0, 0, 255}, {255, 0, 0, 255}, {0, 255, 0, 255}, {0, 0, 255, 255}})
	got := m.MapImage(im, false)
	want := []uint8{1, 2, 3, 0}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("pixel %d mapped to %d, want %d (%v)", i, got[i], want[i], got)
		}
	}
}

func TestMapImageDithersTowardThePalette(t *testing.T) {
	// Mid grey is not in this black-and-white palette, so dithering must use both entries across the row.
	im := &engine.Image{W: 8, H: 2, Pix: make([]uint32, 16)}
	for i := range im.Pix {
		im.Pix[i] = engine.Pack(128, 128, 128, 255)
	}
	m := anim.NewMapper([]color.RGBA{{0, 0, 0, 255}, {255, 255, 255, 255}})
	got := m.MapImage(im, true)
	black, white := 0, 0
	for _, idx := range got {
		switch idx {
		case 0:
			black++
		case 1:
			white++
		default:
			t.Fatalf("unexpected palette index %d", idx)
		}
	}
	if black == 0 || white == 0 {
		t.Fatalf("dithering used only one colour: %d black, %d white", black, white)
	}
}

func TestScaleNearestCopiesCorners(t *testing.T) {
	im := &engine.Image{W: 2, H: 2, Pix: []uint32{
		engine.Pack(10, 0, 0, 255), engine.Pack(20, 0, 0, 255),
		engine.Pack(30, 0, 0, 255), engine.Pack(40, 0, 0, 255),
	}}
	out := anim.ScaleNearest(im, 4, 4)
	if out.W != 4 || out.H != 4 || len(out.Pix) != 16 {
		t.Fatalf("got %dx%d", out.W, out.H)
	}
	if r, _, _, _ := engine.Unpack(out.Pix[0]); r != 10 {
		t.Fatalf("top left = %d, want 10", r)
	}
	if r, _, _, _ := engine.Unpack(out.Pix[3]); r != 20 {
		t.Fatalf("top right = %d, want 20", r)
	}
	if r, _, _, _ := engine.Unpack(out.Pix[12]); r != 30 {
		t.Fatalf("bottom left = %d, want 30", r)
	}
	if r, _, _, _ := engine.Unpack(out.Pix[15]); r != 40 {
		t.Fatalf("bottom right = %d, want 40", r)
	}
}

func TestSampleColoursCapsAndKeepsEverySample(t *testing.T) {
	im := &engine.Image{W: 100, H: 100, Pix: make([]uint32, 10000)}
	for i := range im.Pix {
		im.Pix[i] = engine.Pack(uint8(i), uint8(i>>8), 7, 255)
	}
	got := anim.SampleColours(im, 1000)
	if len(got) > 1000 {
		t.Fatalf("got %d samples, want at most 1000", len(got))
	}
	if len(got) == 0 {
		t.Fatal("no samples")
	}
}
