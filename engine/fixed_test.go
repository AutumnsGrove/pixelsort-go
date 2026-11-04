package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"pgregory.net/rapid"
)

func TestSin1000(t *testing.T) {
	for p, want := range map[uint32]int32{0: 0, 8192: 750, 16384: 1000, 24576: 750, 32768: 0, 40960: -750, 49152: -1000, 57344: -750, 65536: 0} {
		if got := engine.Sin1000(p); got != want {
			t.Errorf("Sin1000(%d)=%d want %d", p, got, want)
		}
	}
}

func TestProp_SinRange(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		p := rapid.Uint32().Draw(t, "phase")
		v := engine.Sin1000(p)
		if v < -1000 || v > 1000 {
			t.Fatalf("Sin1000(%d) = %d, outside -1000..1000", p, v)
		}
		if engine.Sin1000(p+65536) != v {
			t.Fatalf("Sin1000 is not periodic at %d", p)
		}
	})
}

func TestProp_Sin1000Antisymmetric(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		p := rapid.Uint32Range(0, 32767).Draw(t, "phase")
		if got, want := engine.Sin1000(p+32768), -engine.Sin1000(p); got != want {
			t.Fatalf("Sin1000(%d+32768) = %d, want %d", p, got, want)
		}
	})
}

func TestLerp255(t *testing.T) {
	tests := []struct {
		name string
		p, q uint32
		a    uint32
		want uint32
	}{
		{"zero weight keeps p", 20, 200, 0, 20},
		{"full weight takes q", 20, 200, 255, 200},
		{"half rounds up", 0, 255, 128, 128},
		{"half of equal values", 7, 7, 128, 7},
		{"one kilo", 100, 100, 255, 100},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := engine.Lerp255(tc.p, tc.q, tc.a); got != tc.want {
				t.Errorf("Lerp255(%d, %d, %d) = %d, want %d", tc.p, tc.q, tc.a, got, tc.want)
			}
		})
	}
	rapid.Check(t, func(t *rapid.T) {
		p := rapid.Uint32Range(0, 255).Draw(t, "p")
		q := rapid.Uint32Range(0, 255).Draw(t, "q")
		a := rapid.Uint32Range(0, 255).Draw(t, "a")
		got := engine.Lerp255(p, q, a)
		lo, hi := min(p, q), max(p, q)
		if got < lo || got > hi {
			t.Fatalf("Lerp255(%d, %d, %d) = %d, outside %d..%d", p, q, a, got, lo, hi)
		}
	})
}
