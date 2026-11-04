package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"pgregory.net/rapid"
)

// TestRNGVectors pins SplitMix64 to the reference sequence. If these change, every golden changes with them.
func TestRNGVectors(t *testing.T) {
	r := engine.NewRNG(0)
	for i, want := range []uint64{0xe220a8397b1dcdaf, 0x6e789e6aa1b965f4, 0x06c45d188009454f} {
		if got := r.Uint64(); got != want {
			t.Fatalf("#%d got %#x want %#x", i, got, want)
		}
	}
	s := engine.NewStream(1, 0)
	if a, b := s.Uint64(), s.Uint64(); a != 0xce30761cd7373f6d || b != 0xa82740738736e4c9 {
		t.Fatalf("stream(1,0) %#x %#x", a, b)
	}
	s = engine.NewStream(7, 3)
	for i, want := range []uint32{74, 71, 14, 15, 14} {
		if got := s.Uint32n(100); got != want {
			t.Fatalf("Uint32n #%d got %d want %d", i, got, want)
		}
	}
}

func TestProp_Uint32nInRange(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.Uint32Range(1, 1<<20).Draw(t, "n")
		rng := engine.NewStream(rapid.Uint32().Draw(t, "seed"), rapid.Uint32().Draw(t, "id"))
		for range 64 {
			if got := rng.Uint32n(n); got >= n {
				t.Fatalf("Uint32n(%d) = %d", n, got)
			}
		}
	})
}

func TestUint32nZero(t *testing.T) {
	if got := engine.NewStream(1, 2).Uint32n(0); got != 0 {
		t.Errorf("Uint32n(0) = %d, want 0", got)
	}
}

func TestProp_StreamsDiffer(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		seed := rapid.Uint32().Draw(t, "seed")
		a := rapid.Uint32().Draw(t, "a")
		b := rapid.Uint32().Draw(t, "b")
		if a == b {
			return
		}
		if engine.NewStream(seed, a).Uint64() == engine.NewStream(seed, b).Uint64() {
			t.Fatalf("streams %d and %d of seed %d agree on their first value", a, b, seed)
		}
	})
}

// TestUint32nUniform is a smoke test, not a statistical suite: 100k draws of 10 buckets should be flat enough
// that a broken multiply-shift (for example one that ignores the high bits) cannot pass.
func TestUint32nUniform(t *testing.T) {
	r := engine.NewStream(11, 22)
	var buckets [10]int
	const draws = 100_000
	for range draws {
		buckets[r.Uint32n(10)]++
	}
	for i, got := range buckets {
		if got < 9000 || got > 11000 {
			t.Errorf("bucket %d has %d of %d draws, want 9000..11000", i, got, draws)
		}
	}
}
