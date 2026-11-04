package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"pgregory.net/rapid"
)

func allKeys() []engine.SortKey {
	return []engine.SortKey{engine.KeyLuma, engine.KeyValue, engine.KeyIntensity, engine.KeyMinimum, engine.KeyHue,
		engine.KeySaturation, engine.KeyRed, engine.KeyGreen, engine.KeyBlue, engine.KeyAlpha}
}

// TestKeyTable is the reference table from docs/dev/reference/primitives_test.go.txt, asked through the public API.
func TestKeyTable(t *testing.T) {
	table := []struct{ r, g, b, hue, sat, luma int }{
		{255, 0, 0, 0, 255, 76}, {0, 255, 0, 85, 255, 149}, {0, 0, 255, 170, 255, 29},
		{255, 255, 0, 42, 255, 225}, {0, 255, 255, 127, 255, 178}, {255, 0, 255, 212, 255, 105},
		{128, 128, 128, 0, 0, 128}, {10, 200, 30, 89, 242, 123}, {0, 0, 0, 0, 0, 0},
		{255, 255, 255, 0, 0, 255}, {200, 100, 50, 14, 191, 124},
	}
	hue := engine.KeyFor(engine.KeyHue, false)
	sat := engine.KeyFor(engine.KeySaturation, false)
	luma := engine.KeyFor(engine.KeyLuma, false)
	for _, c := range table {
		p := engine.Pack(uint8(c.r), uint8(c.g), uint8(c.b), 255)
		if got := int(hue(p)); got != c.hue {
			t.Errorf("(%d,%d,%d) hue = %d, want %d", c.r, c.g, c.b, got, c.hue)
		}
		if got := int(sat(p)); got != c.sat {
			t.Errorf("(%d,%d,%d) saturation = %d, want %d", c.r, c.g, c.b, got, c.sat)
		}
		if got := int(luma(p)); got != c.luma {
			t.Errorf("(%d,%d,%d) luma = %d, want %d", c.r, c.g, c.b, got, c.luma)
		}
	}
}

func TestChannelKeys(t *testing.T) {
	tests := []struct {
		pixel                 [4]uint8
		value, intensity, min uint8
		r, g, b, a            uint8
	}{
		{pixel: [4]uint8{10, 200, 30, 255}, value: 200, intensity: 80, min: 10, r: 10, g: 200, b: 30, a: 255},
		{pixel: [4]uint8{200, 100, 50, 128}, value: 200, intensity: 116, min: 50, r: 200, g: 100, b: 50, a: 128},
	}
	for _, tc := range tests {
		p := engine.Pack(tc.pixel[0], tc.pixel[1], tc.pixel[2], tc.pixel[3])
		for name, want := range map[engine.SortKey]uint8{
			engine.KeyValue: tc.value, engine.KeyIntensity: tc.intensity, engine.KeyMinimum: tc.min,
			engine.KeyRed: tc.r, engine.KeyGreen: tc.g, engine.KeyBlue: tc.b, engine.KeyAlpha: tc.a,
		} {
			if got := engine.KeyFor(name, false)(p); got != want {
				t.Errorf("%v %s = %d, want %d", tc.pixel, name, got, want)
			}
		}
	}
}

// TestHueIsAColourWheel walks the pure hues: the key must rise through the wheel, so sorting by hue groups
// colours the way a person would expect.
func TestHueIsAColourWheel(t *testing.T) {
	hue := engine.KeyFor(engine.KeyHue, false)
	wheel := [][3]uint8{{255, 0, 0}, {255, 255, 0}, {0, 255, 0}, {0, 255, 255}, {0, 0, 255}, {255, 0, 255}}
	want := []uint8{0, 42, 85, 127, 170, 212}
	for i, c := range wheel {
		if got := hue(engine.Pack(c[0], c[1], c[2], 255)); got != want[i] {
			t.Fatalf("hue of %v = %d, want %d", c, got, want[i])
		}
	}
}

func TestReverse(t *testing.T) {
	rng := engine.NewRNG(42)
	for _, k := range allKeys() {
		fwd, rev := engine.KeyFor(k, false), engine.KeyFor(k, true)
		for range 256 {
			p := uint32(rng.Uint64())
			if got, want := rev(p), 255-fwd(p); got != want {
				t.Fatalf("%s reversed key of %#x = %d, want %d", k, p, got, want)
			}
		}
	}
}

func TestComputeKeys(t *testing.T) {
	im, err := engine.FromRGBA(2, 1, []byte{10, 200, 30, 255, 200, 100, 50, 128})
	if err != nil {
		t.Fatal(err)
	}
	keys := engine.ComputeKeys(im, engine.KeyRed, false)
	if len(keys) != 2 || keys[0] != 10 || keys[1] != 200 {
		t.Errorf("ComputeKeys(red) = %v, want [10 200]", keys)
	}
	keys = engine.ComputeKeys(im, engine.KeyRed, true)
	if len(keys) != 2 || keys[0] != 245 || keys[1] != 55 {
		t.Errorf("ComputeKeys(red, reverse) = %v, want [245 55]", keys)
	}
}

func TestKeyForUnknownKeyPanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("KeyFor with an unknown key did not panic")
		}
	}()
	engine.KeyFor(engine.SortKey("nope"), false)
}

func TestProp_KeyOrderingStable(t *testing.T) {
	// Reversing a key must not turn a tie into an order: equal keys stay equal, so stable sorts stay stable.
	rapid.Check(t, func(t *rapid.T) {
		k := rapid.SampledFrom(allKeys()).Draw(t, "key")
		a := rapid.Uint32().Draw(t, "a")
		b := rapid.Uint32().Draw(t, "b")
		if engine.KeyFor(k, false)(a) == engine.KeyFor(k, false)(b) {
			if engine.KeyFor(k, true)(a) != engine.KeyFor(k, true)(b) {
				t.Fatalf("%s reversed splits a tie between %#x and %#x", k, a, b)
			}
		}
	})
}
