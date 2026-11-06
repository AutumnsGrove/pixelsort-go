package engine_test

import (
	"encoding/binary"
	"errors"
	"math"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

var (
	green = engine.Pack(40, 80, 50, 255)
	red   = engine.Pack(200, 60, 30, 255)
	blue  = engine.Pack(30, 60, 200, 255)
)

// scene paints discs and rectangles on a flat green picture.
type scene struct{ im *engine.Image }

func newScene(t testing.TB, w, h int) *scene {
	t.Helper()
	im, err := engine.NewImage(w, h)
	if err != nil {
		t.Fatal(err)
	}
	for i := range im.Pix {
		im.Pix[i] = green
	}
	return &scene{im}
}

func (s *scene) disc(cx, cy, r int, c uint32) *scene {
	for y := 0; y < s.im.H; y++ {
		for x := 0; x < s.im.W; x++ {
			if (x-cx)*(x-cx)+(y-cy)*(y-cy) <= r*r {
				s.im.Pix[y*s.im.W+x] = c
			}
		}
	}
	return s
}

func (s *scene) rect(x0, y0, x1, y1 int, c uint32) *scene {
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			s.im.Pix[y*s.im.W+x] = c
		}
	}
	return s
}

func TestCutOutOfADiscFindsTheDisc(t *testing.T) {
	im := newScene(t, 200, 120).disc(100, 60, 30, red).im
	c, err := engine.CutOut(im, 100, 60, 30, 45)
	if err != nil {
		t.Fatal(err)
	}
	want := math.Pi * 30 * 30
	if got := float64(c.Area); math.Abs(got-want)/want > 0.05 {
		t.Fatalf("area %v, want about %v", got, want)
	}
	if b := c.BBox; b[0] < 69 || b[0] > 71 || b[1] < 29 || b[1] > 31 || b[2] < 59 || b[2] > 62 || b[3] < 59 || b[3] > 62 {
		t.Fatalf("bbox %v, want about [70 30 61 61]", b)
	}
	if c.Mean != [3]uint8{200, 60, 30} {
		t.Fatalf("mean colour %v", c.Mean)
	}
	if n := len(c.Outline); n < 8 || n > engine.CutoutMaxPoints {
		t.Fatalf("%d points", n)
	}
	if c.PointsBefore < len(c.Outline) {
		t.Fatalf("simplified to %d from %d: simplifying must not add points", len(c.Outline), c.PointsBefore)
	}
	// every outline point lies on the disc's edge: inside the region, touching the outside
	for _, p := range c.Outline {
		if c.Mask[p.Y*im.W+p.X] != 1 {
			t.Fatalf("outline point %v is outside the region", p)
		}
		if d := math.Hypot(float64(p.X-100), float64(p.Y-60)); d < 28 || d > 31 {
			t.Fatalf("outline point %v is %.1f from the centre; a radius-30 disc's edge is about 30", p, d)
		}
	}
	if len(c.Mask) != im.W*im.H {
		t.Fatal("the mask is the size of the picture")
	}
}

func TestCutOutOfARectangleSimplifiesToItsCorners(t *testing.T) {
	im := newScene(t, 160, 100).rect(40, 30, 120, 70, red).im
	c, err := engine.CutOut(im, 80, 50, 30, 45)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Outline) > 8 {
		t.Fatalf("a rectangle should need only a few points, got %d: %v", len(c.Outline), c.Outline)
	}
	if c.BBox != [4]int{40, 30, 80, 40} {
		t.Fatalf("bbox %v, want [40 30 80 40]", c.BBox)
	}
	if c.Area != 80*40 {
		t.Fatalf("area %d, want %d", c.Area, 80*40)
	}
}

func TestCutOutFillsSmallHolesButKeepsBigOnesOpen(t *testing.T) {
	// a disc with a one-pixel speck of the wrong colour in it: the speck must not leave a hole in the cut-out
	small := newScene(t, 200, 120).disc(100, 60, 30, red)
	small.im.Pix[60*200+100] = blue
	c, err := engine.CutOut(small.im, 90, 60, 30, 45)
	if err != nil {
		t.Fatal(err)
	}
	if c.Mask[60*200+100] != 1 {
		t.Fatal("a one-pixel hole should be filled")
	}
	// a big hole (a ring) is the picture's own shape: the region stays a ring, and the outline is the outer edge
	ring := newScene(t, 200, 120).disc(100, 60, 40, red).disc(100, 60, 20, green)
	c, err = engine.CutOut(ring.im, 100+30, 60, 30, 45)
	if err != nil {
		t.Fatal(err)
	}
	if c.Mask[60*200+100] != 0 {
		t.Fatal("the hole of a ring is not part of the region")
	}
	for _, p := range c.Outline {
		if d := math.Hypot(float64(p.X-100), float64(p.Y-60)); d < 37 {
			t.Fatalf("the outline follows the outer edge only, but %v is %.1f from the centre", p, d)
		}
	}
}

func TestCutOutToleranceOnlyEverGrowsTheRegion(t *testing.T) {
	// a soft edge: the disc fades into the background over a few pixels
	s := newScene(t, 200, 120)
	for y := 0; y < 120; y++ {
		for x := 0; x < 200; x++ {
			d := math.Hypot(float64(x-100), float64(y-60))
			k := math.Min(1, math.Max(0, (d-25)/15))
			r, g, b := 200*(1-k)+40*k, 60*(1-k)+80*k, 30*(1-k)+50*k
			s.im.Pix[y*200+x] = engine.Pack(uint8(r), uint8(g), uint8(b), 255)
		}
	}
	prev := 0
	for _, tol := range []int{5, 15, 30, 45, 60} {
		c, err := engine.CutOut(s.im, 100, 60, tol, 90)
		if err != nil {
			t.Fatalf("tolerance %d: %v", tol, err)
		}
		if c.Area < prev {
			t.Fatalf("tolerance %d gave a smaller region (%d) than the one below (%d)", tol, c.Area, prev)
		}
		prev = c.Area
	}
}

func TestCutOutRefusesARegionThatSpreadsOverThePicture(t *testing.T) {
	im := newScene(t, 200, 120).disc(100, 60, 20, red).im
	_, err := engine.CutOut(im, 5, 5, 30, 45) // the green background is about 94% of the frame
	if !errors.Is(err, engine.ErrCutoutTooBig) {
		t.Fatalf("got %v, want ErrCutoutTooBig", err)
	}
}

func TestCutOutRefusesAnAreaTooSmallToBeAShape(t *testing.T) {
	im := newScene(t, 200, 120).im
	im.Pix[60*200+100] = red // one pixel
	if _, err := engine.CutOut(im, 100, 60, 30, 45); !errors.Is(err, engine.ErrCutoutTooSmall) {
		t.Fatalf("got %v, want ErrCutoutTooSmall", err)
	}
}

// Found by the fuzzer: a region one pixel wide traces out and back, and simplifies to two points, which is a line, not a shape.
func TestCutOutRefusesALineOnePixelWide(t *testing.T) {
	im := newScene(t, 200, 120).rect(20, 60, 180, 61, red).im
	if _, err := engine.CutOut(im, 100, 60, 30, 45); !errors.Is(err, engine.ErrCutoutTooSmall) {
		t.Fatalf("got %v, want ErrCutoutTooSmall for a line", err)
	}
}

func TestCutOutClampsTheClickAndNeverPanicsOnSmallPictures(t *testing.T) {
	im := newScene(t, 200, 120).disc(100, 60, 30, red).im
	for _, p := range [][2]int{{-50, -50}, {9999, 9999}, {0, 119}, {199, 0}} {
		_, _ = engine.CutOut(im, p[0], p[1], 30, 45) // an error is fine; a panic is not
	}
	for _, sz := range [][2]int{{1, 1}, {1, 40}, {40, 1}, {3, 3}} {
		tiny, _ := engine.NewImage(sz[0], sz[1])
		if _, err := engine.CutOut(tiny, 0, 0, 30, 45); err == nil {
			t.Errorf("a %dx%d picture has no object to cut out", sz[0], sz[1])
		}
	}
}

func TestCutOutIsDeterministic(t *testing.T) {
	im := newScene(t, 200, 120).disc(100, 60, 30, red).disc(40, 40, 15, blue).im
	a, _ := engine.CutOut(im, 100, 60, 30, 45)
	b, _ := engine.CutOut(im, 100, 60, 30, 45)
	if len(a.Outline) != len(b.Outline) || a.Area != b.Area {
		t.Fatal("two runs differ")
	}
	for i := range a.Outline {
		if a.Outline[i] != b.Outline[i] {
			t.Fatal("two runs gave different outlines")
		}
	}
}

func TestCutOutOutlineIsPinned(t *testing.T) {
	im := newScene(t, 200, 120).disc(100, 60, 30, red).im
	c, err := engine.CutOut(im, 100, 60, 30, 45)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 0, len(c.Outline)*8)
	for _, p := range c.Outline {
		buf = binary.LittleEndian.AppendUint32(buf, uint32(p.X))
		buf = binary.LittleEndian.AppendUint32(buf, uint32(p.Y))
	}
	testutil.Golden(t, "cutout-disc-outline", buf)
	testutil.Golden(t, "cutout-disc-mask", c.Mask)
}

func FuzzCutOut(f *testing.F) {
	f.Add(uint8(40), uint8(30), int16(10), int16(10), uint8(30), uint8(45), int64(1))
	f.Add(uint8(1), uint8(1), int16(0), int16(0), uint8(5), uint8(10), int64(2))
	f.Add(uint8(90), uint8(7), int16(-4), int16(300), uint8(80), uint8(99), int64(3))
	f.Fuzz(func(t *testing.T, w, h uint8, x, y int16, tol, maxPct uint8, seed int64) {
		if w == 0 || h == 0 {
			return
		}
		im, err := engine.NewImage(int(w), int(h))
		if err != nil {
			return
		}
		rng := engine.NewRNG(uint64(seed))
		for i := range im.Pix {
			if rng.Uint32n(4) == 0 {
				im.Pix[i] = engine.Pack(uint8(rng.Uint32n(256)), uint8(rng.Uint32n(256)), uint8(rng.Uint32n(256)), 255)
			} else {
				im.Pix[i] = green
			}
		}
		c, err := engine.CutOut(im, int(x), int(y), int(tol), int(maxPct))
		if err != nil {
			return
		}
		if len(c.Outline) > engine.CutoutMaxPoints || len(c.Outline) < 3 {
			t.Fatalf("%d outline points", len(c.Outline))
		}
		if len(c.Mask) != int(w)*int(h) {
			t.Fatal("mask size")
		}
		for _, p := range c.Outline {
			if p.X < 0 || p.Y < 0 || p.X >= int(w) || p.Y >= int(h) {
				t.Fatalf("point %v outside %dx%d", p, w, h)
			}
		}
		b := c.BBox
		if b[0] < 0 || b[1] < 0 || b[2] < 1 || b[3] < 1 || b[0]+b[2] > int(w) || b[1]+b[3] > int(h) {
			t.Fatalf("bbox %v outside %dx%d", b, w, h)
		}
		n := 0
		for _, v := range c.Mask {
			if v > 1 {
				t.Fatal("mask is 0/1")
			}
			n += int(v)
		}
		if n < c.Area {
			t.Fatalf("mask holds %d pixels but the area is %d", n, c.Area)
		}
	})
}
