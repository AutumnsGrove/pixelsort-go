package engine_test

import (
	"bytes"
	"errors"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"pgregory.net/rapid"
)

func TestNewImageSizes(t *testing.T) {
	tests := []struct {
		name    string
		w, h    int
		wantErr bool
	}{
		{"zero width", 0, 5, true},
		{"zero height", 5, 0, true},
		{"negative width", -1, 3, true},
		{"one pixel", 1, 1, false},
		{"maximum pixel count", engine.MaxPixels, 1, false},
		{"one past the maximum", engine.MaxPixels + 1, 1, true},
		{"both dimensions huge", 1 << 31, 1 << 31, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			im, err := engine.NewImage(tc.w, tc.h)
			if tc.wantErr {
				if !errors.Is(err, engine.ErrBadSize) {
					t.Fatalf("NewImage(%d, %d) error = %v, want ErrBadSize", tc.w, tc.h, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("NewImage(%d, %d): %v", tc.w, tc.h, err)
			}
			if im.W != tc.w || im.H != tc.h || len(im.Pix) != tc.w*tc.h {
				t.Fatalf("NewImage(%d, %d) = %dx%d with %d pixels", tc.w, tc.h, im.W, im.H, len(im.Pix))
			}
		})
	}
}

func TestPackUnpack(t *testing.T) {
	colours := [][4]uint8{
		{0, 0, 0, 0}, {255, 255, 255, 255}, {255, 0, 0, 255}, {0, 255, 0, 255},
		{0, 0, 255, 255}, {1, 2, 3, 4}, {128, 64, 32, 16}, {17, 200, 3, 250},
	}
	for _, c := range colours {
		r, g, b, a := engine.Unpack(engine.Pack(c[0], c[1], c[2], c[3]))
		if r != c[0] || g != c[1] || b != c[2] || a != c[3] {
			t.Errorf("Pack/Unpack(%v) = %d,%d,%d,%d", c, r, g, b, a)
		}
	}
	// The bytes of a packed pixel are R, G, B, A in memory order on every platform we build for (E1).
	if got := engine.Pack(1, 2, 3, 4); got != 0x04030201 {
		t.Errorf("Pack(1,2,3,4) = %#08x, want 0x04030201", got)
	}
}

func TestFromRGBAAndBack(t *testing.T) {
	rgba := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	im, err := engine.FromRGBA(2, 1, rgba)
	if err != nil {
		t.Fatal(err)
	}
	if got := im.RGBA(); !bytes.Equal(got, rgba) {
		t.Errorf("RGBA() = %v, want %v", got, rgba)
	}
	if im.Pix[0] != engine.Pack(1, 2, 3, 4) || im.Pix[1] != engine.Pack(5, 6, 7, 8) {
		t.Errorf("packed pixels = %#x %#x", im.Pix[0], im.Pix[1])
	}
}

func TestFromRGBABadLength(t *testing.T) {
	for _, n := range []int{0, 3, 7, 9, 12} {
		if _, err := engine.FromRGBA(2, 1, make([]byte, n)); !errors.Is(err, engine.ErrBadData) {
			t.Errorf("FromRGBA(2,1,len %d) error = %v, want ErrBadData", n, err)
		}
	}
}

func TestFromRGBABadSizeWinsFirst(t *testing.T) {
	// A bad size is reported as a size problem even when the data is wrong too.
	if _, err := engine.FromRGBA(0, 0, nil); !errors.Is(err, engine.ErrBadSize) {
		t.Errorf("error = %v, want ErrBadSize", err)
	}
}

func TestCloneIsIndependent(t *testing.T) {
	im, err := engine.FromRGBA(2, 1, []byte{1, 2, 3, 4, 5, 6, 7, 8})
	if err != nil {
		t.Fatal(err)
	}
	cp := im.Clone()
	cp.Pix[0] = 0
	if im.Pix[0] == 0 {
		t.Fatal("Clone shares pixels with the original")
	}
}

func TestProp_RGBARoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 40).Draw(t, "w")
		h := rapid.IntRange(1, 40).Draw(t, "h")
		n := 4 * w * h
		data := rapid.SliceOfN(rapid.Byte(), n, n).Draw(t, "rgba")
		im, err := engine.FromRGBA(w, h, data)
		if err != nil {
			t.Fatalf("FromRGBA(%d, %d, %d bytes): %v", w, h, n, err)
		}
		if got := im.RGBA(); !bytes.Equal(got, data) {
			t.Fatalf("round trip changed %d bytes", len(data))
		}
	})
}
