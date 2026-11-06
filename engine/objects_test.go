package engine_test

import (
	"math"
	"strings"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

func TestListObjectsFindsTheDistinctAreasBiggestFirst(t *testing.T) {
	// a green picture with a big red disc and a small blue one
	im := newScene(t, 200, 120).disc(60, 60, 30, red).disc(160, 30, 12, blue).im
	objs := engine.ListObjects(im, 1, 8)
	if len(objs) != 2 {
		t.Fatalf("want the two discs (the 80%% background is not an object), got %d: %+v", len(objs), objs)
	}
	big, small := objs[0], objs[1]
	if big.AreaPct <= small.AreaPct {
		t.Fatal("biggest first")
	}
	if big.ID != "r1" || small.ID != "r2" {
		t.Fatalf("ids %q %q: they number the list in order", big.ID, small.ID)
	}
	if want := math.Pi * 30 * 30 * 100 / (200 * 120); math.Abs(big.AreaPct-want) > 0.5 {
		t.Fatalf("red disc is %.2f%%, want about %.2f%%", big.AreaPct, want)
	}
	if math.Abs(big.CX-0.3) > 0.02 || math.Abs(big.CY-0.5) > 0.03 {
		t.Fatalf("centre %.2f,%.2f, want about 0.30,0.50", big.CX, big.CY)
	}
	// the seed is a point inside the object, so cutting out from it gives that object
	c, err := engine.CutOut(im, int(big.SeedX*200), int(big.SeedY*120), 28, 45)
	if err != nil || math.Abs(float64(c.Area)-math.Pi*900) > 120 {
		t.Fatalf("cutting out at the seed gave %v, %v", c.Area, err)
	}
	if !strings.Contains(big.Name, "red") || !strings.Contains(small.Name, "blue") {
		t.Fatalf("names should say the colour: %q, %q", big.Name, small.Name)
	}
	if !strings.Contains(big.Name, "left") || !strings.Contains(small.Name, "right") {
		t.Fatalf("names should say where: %q, %q", big.Name, small.Name)
	}
	if big.Colour != "#c83c1e" {
		t.Fatalf("mean colour %s", big.Colour)
	}
}

func TestListObjectsHonoursMinimumAndLimit(t *testing.T) {
	im := newScene(t, 200, 120).disc(60, 60, 30, red).disc(160, 30, 12, blue).im
	if n := len(engine.ListObjects(im, 5, 8)); n != 1 {
		t.Fatalf("a 5%% minimum drops the small disc, got %d objects", n)
	}
	if n := len(engine.ListObjects(im, 1, 1)); n != 1 {
		t.Fatalf("a limit of 1, got %d", n)
	}
	if engine.ListObjects(im, 1, 0) != nil {
		t.Fatal("a limit of 0 is an empty list")
	}
}

func TestListObjectsOnAFlatOrTinyPictureIsEmptyNotAPanic(t *testing.T) {
	if got := engine.ListObjects(newScene(t, 100, 100).im, 1, 8); len(got) != 0 {
		t.Fatalf("a flat picture has no objects: %+v", got)
	}
	tiny, _ := engine.NewImage(1, 1)
	_ = engine.ListObjects(tiny, 1, 8)
}

func TestListObjectsIsDeterministic(t *testing.T) {
	im := newScene(t, 200, 120).disc(60, 60, 30, red).disc(160, 30, 12, blue).im
	a, b := engine.ListObjects(im, 1, 8), engine.ListObjects(im, 1, 8)
	if len(a) != len(b) {
		t.Fatal("two runs differ")
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("object %d differs", i)
		}
	}
}

func TestDescribeSaysWhatIsInThePicture(t *testing.T) {
	im := newScene(t, 200, 120).disc(60, 60, 30, red).im
	d := engine.Describe(im)
	if d.W != 200 || d.H != 120 {
		t.Fatalf("size %dx%d", d.W, d.H)
	}
	if len(d.Palette) < 2 || len(d.Palette) > 6 {
		t.Fatalf("palette %v", d.Palette)
	}
	if d.Palette[0] != "#285032" { // the green background is most of the picture
		t.Fatalf("the most common colour should lead: %v", d.Palette)
	}
	if d.EdgeDensity <= 0 || d.EdgeDensity > 0.2 {
		t.Fatalf("edge density %v", d.EdgeDensity)
	}
	if d.BrightestX < 0 || d.BrightestX > 1 || d.BrightestY < 0 || d.BrightestY > 1 {
		t.Fatalf("brightest %v,%v is outside the picture", d.BrightestX, d.BrightestY)
	}
	// the red disc (luma 98) is brighter than the green around it (luma 65), so the brightest pixel is on the disc
	if d.BrightestX < 0.15 || d.BrightestX > 0.45 || d.BrightestY < 0.2 || d.BrightestY > 0.8 {
		t.Fatalf("brightest at %v,%v, want on the red disc", d.BrightestX, d.BrightestY)
	}
}
