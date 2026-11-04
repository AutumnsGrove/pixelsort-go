package engine

import (
	"slices"
	"testing"
)

func cells(s string) []uint8 {
	out := make([]uint8, len(s))
	for i, c := range s {
		out[i] = uint8(c - '0')
	}
	return out
}

func rowString(r []uint8) string {
	b := make([]byte, len(r))
	for i, v := range r {
		b[i] = '0' + v
	}
	return string(b)
}

func TestCARowsKnownRules(t *testing.T) {
	// Worked by hand from 0001000 with fixed (zero) borders. Rule 90 is left XOR right; rule 30 is left XOR (centre
	// OR right); rule 110 maps 111,100,000 to 0 and the other five neighbourhoods to 1.
	tests := []struct {
		name  string
		rule  uint8
		first string
		want  []string
	}{
		// Rule 90 re-derived (the plan listed 0101010 and 1000001, which do not follow): row 2 lights x1 (0 XOR 1) and x5,
		// but not x3 (1 XOR 1); row 3 lights x0, x2, x4 and x6.
		{"rule 90", 90, "0001000", []string{"0010100", "0100010", "1010101"}},
		{"rule 30", 30, "0001000", []string{"0011100", "0110010"}},
		{"rule 110", 110, "0001000", []string{"0011000", "0111000"}},
		{"rule 0 clears", 0, "0101101", []string{"0000000", "0000000"}},
		{"rule 255 fills", 255, "0101101", []string{"1111111", "1111111"}},
		{"rule 204 repeats", 204, "0101101", []string{"0101101", "0101101"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rows := caRows(cells(tc.first), len(tc.want)+1, tc.rule, CABoundaryFixed, nil)
			if rowString(rows[0]) != tc.first {
				t.Fatalf("row 0 changed: %s", rowString(rows[0]))
			}
			for i, w := range tc.want {
				if got := rowString(rows[i+1]); got != w {
					t.Errorf("row %d: got %s, want %s", i+1, got, w)
				}
			}
		})
	}
}

func TestCARowsWrapDiffersFromFixedAtTheEdges(t *testing.T) {
	// Rule 90 from 1000000: fixed gives 0100000, wrap also lights the last cell (its right neighbour is cell 0).
	fixed := caRows(cells("1000000"), 2, 90, CABoundaryFixed, nil)[1]
	wrap := caRows(cells("1000000"), 2, 90, CABoundaryWrap, nil)[1]
	if rowString(fixed) != "0100000" || rowString(wrap) != "0100001" {
		t.Fatalf("fixed %s, wrap %s", rowString(fixed), rowString(wrap))
	}
}

func TestCARowsRandomBoundaryDrawsEdgesLeftThenRight(t *testing.T) {
	rng := NewStream(5, 9)
	rows := caRows(cells("00000"), 3, 204, CABoundaryRandom, rng)
	check := NewStream(5, 9)
	for y := 1; y < 3; y++ {
		l, r := uint8(check.Uint32n(2)), uint8(check.Uint32n(2))
		if rows[y][0] != l || rows[y][4] != r {
			t.Fatalf("row %d edges %d,%d, want %d,%d", y, rows[y][0], rows[y][4], l, r)
		}
	}
}

func TestCAMapImageNearest(t *testing.T) {
	got := CAMapImage(5, 5, 3, [][]uint8{{1, 0}, {0, 1}})
	want := bitsRows("11100", "11100", "11100", "00011", "00011")
	if !slices.Equal(got, want) {
		t.Fatalf("got\n%v\nwant\n%v", got, want)
	}
}

func bitsRows(rows ...string) []uint8 {
	var out []uint8
	for _, r := range rows {
		out = append(out, cells(r)...)
	}
	return out
}
