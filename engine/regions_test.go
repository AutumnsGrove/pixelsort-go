package engine_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

func TestPartitionRegionsNilEqualsPartition(t *testing.T) {
	for _, a := range []int{0, 17, 45, 90, 135, 217, 315, 359} {
		want := engine.Partition(11, 7, a)
		got := engine.PartitionRegions(11, 7, a, nil)
		if !slices.Equal(got.P, want.P) || !slices.Equal(got.Starts, want.Starts) {
			t.Fatalf("angle %d: nil regions differ from Partition", a)
		}
	}
}

// TestPartitionRegionsCellsCutLines uses a 6x1 image whose cells are 0, then 1 1, then 2 2 2, all in class 1
// except cell 0 (class 0), at angle 0. Walking left to right:
//
//	pos 0: class 0, a new line starts                                  -> line [0]
//	pos 1: class 1, new line (the class changed)                       -> line [1]
//	pos 2: label 1, same cell, continues                               -> line [1 2]
//	pos 3: label 2, the cell changed, so a new line starts             -> line [3]
//	pos 4,5: label 2 continues                                         -> line [3 4 5]
//
// Starts are therefore 0, 1, 3 and 6.
func TestPartitionRegionsCellsCutLines(t *testing.T) {
	zero := 0
	regions := &engine.Regions{
		Labels:  []uint16{0, 1, 1, 2, 2, 2},
		ClassOf: []uint8{0, 1, 1},
		Defs:    []engine.ClassDef{{}, {Angle: &zero}},
	}
	if err := regions.Validate(6, 1); err != nil {
		t.Fatal(err)
	}
	got := engine.PartitionRegions(6, 1, 0, regions)
	if want := []int32{0, 1, 2, 3, 4, 5}; !slices.Equal(got.P, want) {
		t.Errorf("P = %v, want %v", got.P, want)
	}
	if want := []int32{0, 1, 3, 6}; !slices.Equal(got.Starts, want) {
		t.Errorf("Starts = %v, want %v", got.Starts, want)
	}
}

// TestPartitionRegionsAngleGroupsAscending checks the fix over the mockup: angle groups are walked in ascending
// angle order, never in Go's map order, so the line list is the same on every run (determinism rule 3).
func TestPartitionRegionsAngleGroupsAscending(t *testing.T) {
	steep, shallow := 100, 20
	labels := make([]uint16, 0, 16)
	for range 4 {
		labels = append(labels, 1, 1, 2, 2)
	}
	regions := &engine.Regions{
		Labels:  labels,
		ClassOf: []uint8{0, 1, 2},
		Defs:    []engine.ClassDef{{}, {Angle: &steep}, {Angle: &shallow}},
	}
	if err := regions.Validate(4, 4); err != nil {
		t.Fatal(err)
	}
	got := engine.PartitionRegions(4, 4, 0, regions)
	if int(got.Starts[1]) <= int(got.Starts[0]) {
		t.Fatal("no lines at all")
	}
	for _, pos := range got.P[got.Starts[0]:got.Starts[1]] {
		if regions.Labels[pos] != 2 {
			t.Fatalf("first line holds cell %d, want cell 2 (the angle-20 group)", regions.Labels[pos])
		}
	}
	if got := engine.PartitionRegions(4, 4, 0, regions); !slices.Equal(got.P, engine.PartitionRegions(4, 4, 0, regions).P) {
		t.Error("two calls disagree")
	}
}

func TestValidateRegions(t *testing.T) {
	ok := &engine.Regions{Labels: []uint16{0, 1, 2, 0}, ClassOf: []uint8{0, 1, 1}, Defs: []engine.ClassDef{{}, {}}}
	if err := ok.Validate(2, 2); err != nil {
		t.Fatalf("valid regions rejected: %v", err)
	}
	tests := []struct {
		name    string
		regions *engine.Regions
		w, h    int
	}{
		{"label buffer wrong length", &engine.Regions{Labels: make([]uint16, 3), ClassOf: []uint8{0}, Defs: []engine.ClassDef{{}}}, 2, 2},
		{"label out of range", &engine.Regions{Labels: []uint16{0, 5, 1, 1}, ClassOf: []uint8{0, 1}, Defs: []engine.ClassDef{{}, {}}}, 2, 2},
		{"class out of range", &engine.Regions{Labels: []uint16{0, 1, 1, 1}, ClassOf: []uint8{0, 3}, Defs: []engine.ClassDef{{}, {}}}, 2, 2},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.regions.Validate(tc.w, tc.h); !errors.Is(err, engine.ErrBadRegions) {
				t.Fatalf("Validate() = %v, want ErrBadRegions", err)
			}
		})
	}
}
