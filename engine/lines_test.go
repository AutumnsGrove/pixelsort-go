package engine

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"testing"
)

// updateSlopes rewrites testdata/slopes.golden instead of comparing against it. It is the package's one -update
// flag for the whole test binary: internal/testutil looks it up by name in Updating() so golden files can be
// rewritten with the same -update. Test files inside package engine cannot import testutil (it imports engine).
var updateSlopes = flag.Bool("update", false, "rewrite testdata/slopes.golden")

func TestPartitionBijection(t *testing.T) {
	for _, sz := range [][2]int{{1, 1}, {1, 40}, {40, 1}, {2, 2}, {3, 5}, {97, 61}, {53, 53}, {61, 97}, {7, 7}, {64, 64}} {
		w, h := sz[0], sz[1]
		for a := 0; a < 360; a++ {
			L := Partition(w, h, a)
			if len(L.P) != w*h || int(L.Starts[len(L.Starts)-1]) != w*h {
				t.Fatalf("%dx%d a=%d: %d pixels", w, h, a, len(L.P))
			}
			seen := make([]bool, w*h)
			for _, p := range L.P {
				if seen[p] {
					t.Fatalf("%dx%d a=%d: duplicate", w, h, a)
				}
				seen[p] = true
			}
		}
	}
}

func TestCardinalDirections(t *testing.T) {
	first := func(a int) [][2]int {
		L := Partition(5, 3, a)
		var o [][2]int
		for _, p := range L.P[L.Starts[0]:L.Starts[1]] {
			o = append(o, [2]int{int(p) % 5, int(p) / 5})
		}
		return o
	}
	for a, want := range map[int][][2]int{
		0:   {{0, 0}, {1, 0}, {2, 0}, {3, 0}, {4, 0}},
		90:  {{0, 2}, {0, 1}, {0, 0}},
		180: {{4, 0}, {3, 0}, {2, 0}, {1, 0}, {0, 0}},
		270: {{0, 0}, {0, 1}, {0, 2}},
	} {
		got := first(a)
		if len(got) != len(want) {
			t.Fatalf("a=%d got %v want %v", a, got, want)
		}
		for i := range got {
			if got[i] != want[i] {
				t.Fatalf("a=%d got %v want %v", a, got, want)
			}
		}
	}
}

// TestSlopeTable pins the once-per-angle float computation. These values were the same on arm64, amd64 and WASM.
func TestSlopeTable(t *testing.T) {
	for a, want := range map[int]int64{0: 0, 1: -1144, 15: -17560, 30: -37837, 44: -63287, 45: -65536, 46: -63287, 60: -37837, 89: -1144, 90: 0, 91: 1144, 135: 65536, 180: 0, 225: -65536, 270: 0, 315: 65536, 359: 1144} {
		if got := axisFor(a).m16; got != want {
			t.Errorf("m16(%d)=%d want %d", a, got, want)
		}
	}
}

// TestAxisRulesAreIntegers checks the angle rules at every boundary. 45 and 135 cannot flip on a rounding error
// because the choice is integer comparisons, not a float compare.
func TestAxisRulesAreIntegers(t *testing.T) {
	tests := []struct {
		from, to int
		xMajor   bool
		sign     int
		walk     string
	}{
		{0, 45, true, 1, "x, left to right"},
		{46, 134, false, -1, "y, bottom to top"},
		{135, 225, true, -1, "x, right to left"},
		{226, 314, false, 1, "y, top to bottom"},
		{315, 359, true, 1, "x, left to right"},
	}
	for _, tc := range tests {
		for a := tc.from; a <= tc.to; a++ {
			ax := axisFor(a)
			if ax.xMajor != tc.xMajor || ax.sign != tc.sign {
				t.Errorf("a=%d: xMajor=%v sign=%d, want %v/%d (%s)", a, ax.xMajor, ax.sign, tc.xMajor, tc.sign, tc.walk)
			}
		}
	}
	// Angles outside 0..359 wrap rather than fail, so a UI can hand us anything.
	if axisFor(360).xMajor != axisFor(0).xMajor || axisFor(-45).sign != axisFor(315).sign {
		t.Error("angles outside 0..359 do not wrap")
	}
}

// slopeTable renders the whole table as "angle m16" lines: 360 short numbers a person can read and diff.
func slopeTable() string {
	var sb strings.Builder
	for a := 0; a < 360; a++ {
		fmt.Fprintf(&sb, "%d %d\n", a, axisFor(a).m16) //nolint:errcheck // a strings.Builder cannot fail
	}
	return sb.String()
}

// TestSlopeTableGolden compares the table with engine/testdata/slopes.golden. This file is checked on arm64,
// amd64 and WASM: if a platform disagrees, the code is wrong (a float fused into one instruction), never the file.
func TestSlopeTableGolden(t *testing.T) {
	const path = "testdata/slopes.golden"
	got := slopeTable()
	if *updateSlopes {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(got), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (create it with: go test ./engine -run SlopeTableGolden -update)", err)
	}
	if string(want) != got {
		for i, line := range strings.Split(got, "\n") {
			wantLines := strings.Split(string(want), "\n")
			if i >= len(wantLines) || wantLines[i] != line {
				t.Fatalf("line %d: got %q, want %q", i, line, wantLines[i])
			}
		}
		t.Fatal("slope tables differ in length")
	}
}
