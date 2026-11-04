package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"pgregory.net/rapid"
)

func TestFeatherRadiusZeroIsTheHardMask(t *testing.T) {
	mask := []uint8{0, 1, 255, 0, 7, 0}
	want := []uint8{0, 255, 255, 0, 255, 0}
	got := engine.Feather(mask, 3, 2, 0)
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("Feather radius 0 = %v, want %v", got, want)
		}
	}
}

func TestFeatherEmptyAndFullMasks(t *testing.T) {
	for _, radius := range []int{0, 1, 3, 100} {
		empty := make([]uint8, 5*4)
		if got := engine.Feather(empty, 5, 4, radius); sum(got) != 0 {
			t.Errorf("radius %d: empty mask blurred to sum %d", radius, sum(got))
		}
		full := make([]uint8, 5*4)
		for i := range full {
			full[i] = 255
		}
		got := engine.Feather(full, 5, 4, radius)
		for i, v := range got {
			if v != 255 {
				t.Fatalf("radius %d: full mask gave %d at %d", radius, v, i)
			}
		}
	}
}

// TestFeatherSinglePixel works the 5x5 case by hand, radius 1 (window 3, rounded by (sum+1)/3):
//
//	horizontal: the middle row becomes [0 85 85 85 0]
//	vertical:   each of columns 1..3 has one 85 among zeros, so rows 1..3 become (85+1)/3 = 28
//
// The result is a 3x3 block of 28 in the middle of a 5x5 of zeros.
func TestFeatherSinglePixel(t *testing.T) {
	mask := make([]uint8, 25)
	mask[2*5+2] = 255
	got := engine.Feather(mask, 5, 5, 1)
	want := make([]uint8, 25)
	for y := 1; y <= 3; y++ {
		for x := 1; x <= 3; x++ {
			want[y*5+x] = 28
		}
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("Feather =\n%v\nwant\n%v", got, want)
		}
	}
}

func TestProp_FeatherRange(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 20).Draw(t, "w")
		h := rapid.IntRange(1, 20).Draw(t, "h")
		radius := rapid.IntRange(-2, 10).Draw(t, "radius")
		mask := rapid.SliceOfN(rapid.Byte(), w*h, w*h).Draw(t, "mask")
		got := engine.Feather(mask, w, h, radius)
		if len(got) != w*h {
			t.Fatalf("%dx%d: %d values", w, h, len(got))
		}
	})
}

// TestProp_FeatherIsSymmetric: a mask that is its own mirror image must blur to one too.
func TestProp_FeatherIsSymmetric(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 16).Draw(t, "w")
		h := rapid.IntRange(1, 16).Draw(t, "h")
		radius := rapid.IntRange(1, 5).Draw(t, "radius")
		mask := make([]uint8, w*h)
		for y := 0; y < h; y++ {
			for x := 0; x < w/2; x++ {
				v := rapid.Byte().Draw(t, "mask")
				mask[y*w+x] = v
				mask[y*w+w-1-x] = v
			}
		}
		got := engine.Feather(mask, w, h, radius)
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				if got[y*w+x] != got[y*w+w-1-x] {
					t.Fatalf("%dx%d radius %d: column %d and its mirror differ", w, h, radius, x)
				}
			}
		}
	})
}

// TestProp_FeatherPreservesMass: a box blur moves brightness around and only rounding changes the total.
//
// Two conditions keep the claim exact: the image must be wider than the window (otherwise one pixel's window covers
// the whole image and divides its brightness by more than n), and the mask is kept `radius` pixels away from the
// border, because replication there repeats the edge pixel instead of reading a zero and quietly adds mass.
func TestProp_FeatherPreservesMass(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		radius := rapid.IntRange(1, 4).Draw(t, "radius")
		w := rapid.IntRange(2*radius+1, 20).Draw(t, "w")
		h := rapid.IntRange(2*radius+1, 20).Draw(t, "h")
		mask := rapid.SliceOfN(rapid.Byte(), w*h, w*h).Draw(t, "mask")
		hard := make([]uint8, w*h)
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				if x < radius || y < radius || x >= w-radius || y >= h-radius {
					continue
				}
				if mask[y*w+x] != 0 {
					hard[y*w+x] = 255
				}
			}
		}
		got := engine.Feather(hard, w, h, radius)
		if diff := sum(got) - sum(hard); diff > w*h || diff < -w*h {
			t.Fatalf("%dx%d radius %d: mass changed by %d", w, h, radius, diff)
		}
	})
}

func sum(v []uint8) int {
	total := 0
	for _, x := range v {
		total += int(x)
	}
	return total
}
