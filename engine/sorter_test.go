package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// redRow builds a 1 x n image whose red channel is reds and whose other channels are zero.
func redRow(reds ...uint8) *engine.Image {
	im := &engine.Image{W: len(reds), H: 1, Pix: make([]uint32, len(reds))}
	for i, r := range reds {
		im.Pix[i] = engine.Pack(r, 0, 0, 255)
	}
	return im
}

func TestSortKnown(t *testing.T) {
	im := redRow(30, 10, 20)
	p := engine.DefaultParams()
	p.Mode = engine.ModeNone
	p.Key = engine.KeyRed
	p.Randomness = 0
	out := planOf(t, im, p, nil).Sort()
	want := []uint32{engine.Pack(10, 0, 0, 255), engine.Pack(20, 0, 0, 255), engine.Pack(30, 0, 0, 255)}
	for i := range want {
		if out.Pix[i] != want[i] {
			t.Fatalf("sorted row = %v, want %v", out.Pix, want)
		}
	}
	if out.W != 3 || out.H != 1 {
		t.Errorf("output is %dx%d", out.W, out.H)
	}
}

func TestSortReverse(t *testing.T) {
	im := redRow(30, 10, 20)
	p := engine.DefaultParams()
	p.Mode = engine.ModeNone
	p.Key = engine.KeyRed
	p.Reverse = true
	p.Randomness = 0
	out := planOf(t, im, p, nil).Sort()
	want := []uint32{engine.Pack(30, 0, 0, 255), engine.Pack(20, 0, 0, 255), engine.Pack(10, 0, 0, 255)}
	for i := range want {
		if out.Pix[i] != want[i] {
			t.Fatalf("reversed row = %v, want %v", out.Pix, want)
		}
	}
}

// TestSortStableTies uses UniqueIDImage: every pixel carries its own index, and red repeats with period 7, so ties
// are everywhere. Equal reds must come out in their original order (PLAN.md 3.5: ties are common and the streaky
// look depends on stability).
func TestSortStableTies(t *testing.T) {
	im := testutil.UniqueIDImage(16, 1)
	p := engine.DefaultParams()
	p.Mode = engine.ModeNone
	p.Key = engine.KeyRed
	p.Randomness = 0
	out := planOf(t, im, p, nil).Sort()
	prevID, prevRed := -1, -1
	for _, px := range out.Pix {
		r, g, b, _ := engine.Unpack(px)
		id := int(b)<<8 | int(g)
		if int(r) == prevRed && id < prevID {
			t.Fatalf("tie broken: red %d saw id %d after %d", r, id, prevID)
		}
		prevID, prevRed = id, int(r)
	}
}

func TestSortDoesNotMutate(t *testing.T) {
	im := testutil.Gradient(20, 5, 6)
	before := make([]uint32, len(im.Pix))
	copy(before, im.Pix)
	p := engine.DefaultParams()
	p.Angle = 30
	pl := planOf(t, im, p, nil)
	first := pl.Sort()
	for i := range before {
		if im.Pix[i] != before[i] {
			t.Fatalf("Sort mutated the input at %d", i)
		}
	}
	second := pl.Sort()
	for i := range first.Pix {
		if first.Pix[i] != second.Pix[i] {
			t.Fatalf("two Sort calls disagree at %d", i)
		}
	}
}

// TestSoftBlend checks the feather blend: 0 shows the pure sort, 255 shows the original, and 128 lands between.
func TestSoftBlend(t *testing.T) {
	im := testutil.Gradient(16, 4, 7)
	p := engine.DefaultParams()
	p.Mode = engine.ModeNone
	p.Randomness = 0
	p.Angle = 0
	softOf := func(v uint8) []uint8 {
		soft := make([]uint8, len(im.Pix))
		for i := range soft {
			soft[i] = v
		}
		return soft
	}
	pure := planOf(t, im, p, nil).Sort()
	opaque := planOf(t, im, p, &engine.Options{Soft: softOf(0)}).Sort()
	original := planOf(t, im, p, &engine.Options{Soft: softOf(255)}).Sort()
	half := planOf(t, im, p, &engine.Options{Soft: softOf(128)}).Sort()
	for i := range im.Pix {
		if opaque.Pix[i] != pure.Pix[i] {
			t.Fatalf("soft 0 is not the pure sort at %d", i)
		}
		if original.Pix[i] != im.Pix[i] {
			t.Fatalf("soft 255 is not the original at %d", i)
		}
		for ch := 0; ch < 4; ch++ {
			shift := uint(8 * ch)
			a := int((opaque.Pix[i] >> shift) & 0xff)
			b := int((original.Pix[i] >> shift) & 0xff)
			got := int((half.Pix[i] >> shift) & 0xff)
			if got < min(a, b) || got > max(a, b) {
				t.Fatalf("soft 128 channel %d at %d = %d, outside %d..%d", ch, i, got, min(a, b), max(a, b))
			}
		}
	}
}
