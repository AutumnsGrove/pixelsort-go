package api_test

import (
	"errors"
	"math"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/engine/api"
)

// discPicture is a flat green 120x80 picture with a red disc of radius 20 in the middle.
func discPicture(t *testing.T) *api.Session {
	t.Helper()
	s := api.NewSession()
	if err := s.Init(120, 80); err != nil {
		t.Fatal(err)
	}
	rgba := make([]byte, 4*120*80)
	for y := 0; y < 80; y++ {
		for x := 0; x < 120; x++ {
			c := [4]byte{40, 80, 50, 255}
			if (x-60)*(x-60)+(y-40)*(y-40) <= 20*20 {
				c = [4]byte{200, 60, 30, 255}
			}
			copy(rgba[4*(y*120+x):], c[:])
		}
	}
	if err := s.SetImage(rgba); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCutOutTakesAPointAsAFractionOfThePicture(t *testing.T) {
	s := discPicture(t)
	c, err := s.CutOut(0.5, 0.5, 30)
	if err != nil {
		t.Fatal(err)
	}
	want := math.Pi * 20 * 20
	if math.Abs(float64(c.Area)-want)/want > 0.06 {
		t.Fatalf("area %d, want about %.0f", c.Area, want)
	}
	// the same disc from another point inside it
	d, err := s.CutOut(0.45, 0.45, 30)
	if err != nil || d.Area != c.Area {
		t.Fatalf("a different click inside the disc gave %v, %v", d.Area, err)
	}
}

func TestCutOutNeedsAnInitAndSaneNumbers(t *testing.T) {
	s := api.NewSession()
	if _, err := s.CutOut(0.5, 0.5, 30); !errors.Is(err, api.ErrState) {
		t.Fatalf("before init: %v", err)
	}
	if err := s.Init(10, 10); err != nil {
		t.Fatal(err)
	}
	// Init makes a blank picture: one flat colour is a region that spreads over everything, so it is refused, not a crash
	if _, err := s.CutOut(0.5, 0.5, 30); !errors.Is(err, engine.ErrCutoutTooBig) {
		t.Fatalf("a blank picture: %v", err)
	}
	p := discPicture(t)
	for _, bad := range [][2]float64{{math.NaN(), 0.5}, {0.5, math.Inf(1)}, {-0.1, 0.5}, {0.5, 1.1}} {
		if _, err := p.CutOut(bad[0], bad[1], 30); err == nil {
			t.Errorf("point %v should be refused", bad)
		}
	}
}

func TestCutOutPassesTheEnginesRefusalsThrough(t *testing.T) {
	p := discPicture(t)
	if _, err := p.CutOut(0.05, 0.05, 30); !errors.Is(err, engine.ErrCutoutTooBig) {
		t.Fatalf("a click on the background: %v", err)
	}
}

func TestCutOutDoesNotDisturbThePictureOrAPlan(t *testing.T) {
	s := discPicture(t)
	if err := s.Configure([]byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Prepare(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CutOut(0.5, 0.5, 30); err != nil {
		t.Fatal(err)
	}
	// the prepared plan is still good: a cut-out only reads the picture
	if err := s.FinishInstant(); err != nil {
		t.Fatalf("the plan was lost by a cut-out: %v", err)
	}
}
