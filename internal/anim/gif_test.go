package anim_test

import (
	"bytes"
	"image/color"
	"image/gif"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/internal/anim"
)

func gifPalette() []color.RGBA {
	return []color.RGBA{
		{R: 0, G: 0, B: 0, A: 255},
		{R: 255, G: 0, B: 0, A: 255},
		{R: 0, G: 255, B: 0, A: 255},
		{R: 0, G: 0, B: 255, A: 255},
	}
}

func TestGIFWriterRoundTripsThroughTheStandardLibrary(t *testing.T) {
	var buf bytes.Buffer
	w, err := anim.NewGIFWriter(&buf, 2, 2, gifPalette(), true)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.AddFrame([]uint8{0, 1, 2, 3}, 100); err != nil {
		t.Fatal(err)
	}
	if err := w.AddFrame([]uint8{3, 2, 1, 0}, 350); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	g, err := gif.DecodeAll(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if g.Config.Width != 2 || g.Config.Height != 2 {
		t.Fatalf("size %dx%d, want 2x2", g.Config.Width, g.Config.Height)
	}
	if len(g.Image) != 2 {
		t.Fatalf("got %d frames, want 2", len(g.Image))
	}
	if g.LoopCount != 0 {
		t.Fatalf("LoopCount = %d, want 0 (forever)", g.LoopCount)
	}
	if len(g.Delay) != 2 || g.Delay[0] != 10 || g.Delay[1] != 35 {
		t.Fatalf("delays %v, want [10 35] hundredths", g.Delay)
	}
	want := []color.RGBA{gifPalette()[0], gifPalette()[1], gifPalette()[2], gifPalette()[3]}
	for i, c := range want {
		got := g.Image[0].Palette[g.Image[0].Pix[i]]
		r, gr, b, _ := c.RGBA()
		gr2, g2, b2, _ := got.RGBA()
		if r>>8 != gr2>>8 || gr>>8 != g2>>8 || b>>8 != b2>>8 {
			t.Fatalf("pixel %d = %v, want %v", i, got, c)
		}
	}
}

func TestGIFWriterWithoutLoopHasNoNetscapeExtension(t *testing.T) {
	var buf bytes.Buffer
	w, err := anim.NewGIFWriter(&buf, 1, 1, gifPalette(), false)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.AddFrame([]uint8{1}, 20); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(buf.Bytes(), []byte("NETSCAPE2.0")) {
		t.Fatal("a non-looping GIF still has the loop extension")
	}
	g, err := gif.DecodeAll(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if g.LoopCount != -1 {
		t.Fatalf("LoopCount = %d, want -1", g.LoopCount)
	}
	if g.Delay[0] != 2 {
		t.Fatalf("short delay = %d, want the 2 hundredths floor", g.Delay[0])
	}
}

func TestGIFWriterRejectsBadInput(t *testing.T) {
	if _, err := anim.NewGIFWriter(&bytes.Buffer{}, 2, 2, nil, false); err == nil {
		t.Fatal("a palette of no colours was accepted")
	}
	tooMany := make([]color.RGBA, 257)
	w, err := anim.NewGIFWriter(&bytes.Buffer{}, 1, 1, tooMany, false)
	if err == nil {
		_ = w.Close()
		t.Fatal("a 257-colour palette was accepted")
	}
	var buf bytes.Buffer
	w, err = anim.NewGIFWriter(&buf, 2, 2, gifPalette(), false)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.AddFrame([]uint8{0, 1}, 10); err == nil {
		t.Fatal("a short frame was accepted")
	}
}
