package shapes

import (
	"errors"
	"testing"
)

// TestCellsFromPlaneIsFourConnected: two areas that only meet at a corner stay two shapes, because the painted line
// passes between them. Eight-connected labelling would fuse them into one cell that the picture sorts across.
func TestCellsFromPlaneIsFourConnected(t *testing.T) {
	// A 3x3 picture whose four corners are cells and whose cross is the painted line.
	plane := []uint8{
		0, 1, 0,
		1, 1, 1,
		0, 1, 0,
	}
	c, err := cellsFromPlane(3, 3, 1, plane)
	if err != nil {
		t.Fatal(err)
	}
	if c.Count != 4 {
		t.Fatalf("%d cells, want 4: %v", c.Count, c.Labels)
	}
	for _, pos := range []int{0, 2, 6, 8} {
		if c.Labels[pos] == 0 {
			t.Fatalf("corner %d is not a cell: %v", pos, c.Labels)
		}
	}
	if c.Labels[0] == c.Labels[2] || c.Labels[0] == c.Labels[6] {
		t.Fatalf("diagonal corners share a cell: %v", c.Labels)
	}
}

// TestCellsFromPlaneNumbersInRasterOrder: ids follow the first-seen pixel, so the same plane always numbers the same
// way (determinism rule 3: nothing may depend on map iteration or fill order).
func TestCellsFromPlaneNumbersInRasterOrder(t *testing.T) {
	// One row, painted in the middle: the area on the left is met first, so it is cell 1 and the right one is 2.
	plane := []uint8{0, 0, 1, 0, 0, 0}
	c, err := cellsFromPlane(6, 1, 1, plane)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := c.Labels, []uint16{1, 1, 0, 2, 2, 2}; len(got) != len(want) {
		t.Fatalf("labels %v, want %v", got, want)
	} else {
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("labels %v, want %v", got, want)
			}
		}
	}
}

// TestCellsFromPlaneOverflowIsAnError: labels are uint16, so a drawing with more areas than that is refused rather than
// silently wrapped into the wrong cells.
func TestCellsFromPlaneOverflowIsAnError(t *testing.T) {
	const w, h = 520, 520
	plane := make([]uint8, w*h)
	areas := 0
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if x%2 == 0 && y%2 == 0 {
				continue
			}
			plane[y*w+x] = 1
		}
	}
	for y := 0; y < h; y += 2 {
		for x := 0; x < w; x += 2 {
			areas++
		}
	}
	if areas <= MaxCells {
		t.Fatalf("the test plane makes %d areas, which does not overflow %d", areas, MaxCells)
	}
	if _, err := cellsFromPlane(w, h, 1, plane); !errors.Is(err, ErrTiling) {
		t.Fatalf("%d areas should be refused: %v", areas, err)
	}
}

// TestCellsFromPlaneChecksItsPlane: a plane that does not match the picture is a programming error, not a crash.
func TestCellsFromPlaneChecksItsPlane(t *testing.T) {
	if _, err := cellsFromPlane(4, 4, 1, make([]uint8, 15)); !errors.Is(err, ErrTiling) {
		t.Fatalf("a short plane should be refused: %v", err)
	}
}
