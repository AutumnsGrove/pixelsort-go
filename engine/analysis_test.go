package engine_test

import (
	"math"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

func TestBrightestSpotLandsInTheBlob(t *testing.T) {
	const w, h = 100, 60
	im := &engine.Image{W: w, H: h, Pix: make([]uint32, w*h)}
	for i := range im.Pix {
		im.Pix[i] = engine.Pack(40, 40, 40, 255)
	}
	// a bright disc of radius 6 centred on (70, 20)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if (x-70)*(x-70)+(y-20)*(y-20) <= 36 {
				im.Pix[y*w+x] = engine.Pack(250, 250, 240, 255)
			}
		}
	}
	cx, cy, ew, eh := engine.BrightestSpot(im)
	if math.Abs(cx*w-70) > 2 || math.Abs(cy*h-20) > 2 {
		t.Fatalf("centre (%.1f, %.1f), want about (70, 20)", cx*w, cy*h)
	}
	if ew*w < 10 || ew*w > 30 || eh*h < 10 || eh*h > 30 {
		t.Fatalf("ellipse %.1f x %.1f px for a 12 px blob", ew*w, eh*h)
	}
	cx2, cy2, ew2, eh2 := engine.BrightestSpot(im)
	if cx != cx2 || cy != cy2 || ew != ew2 || eh != eh2 {
		t.Fatal("not deterministic")
	}
}

func TestBrightestSpotOnAFlatImageIsFinite(t *testing.T) {
	im := &engine.Image{W: 20, H: 10, Pix: make([]uint32, 200)}
	for i := range im.Pix {
		im.Pix[i] = engine.Pack(128, 128, 128, 255)
	}
	for _, v := range func() []float64 { a, b, c, d := engine.BrightestSpot(im); return []float64{a, b, c, d} }() {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			t.Fatalf("non-finite result %v", v)
		}
	}
	if a, b, c, d := engine.BrightestSpot(&engine.Image{}); math.IsNaN(a + b + c + d) {
		t.Fatal("an empty image must not give NaN")
	}
}
