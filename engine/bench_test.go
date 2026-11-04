package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// benchSizes are the image sizes the plan and the sorter are measured at. A phone photo is about 8 MP, a DSLR frame
// about 24 MP.
var benchSizes = []struct {
	name string
	w, h int
}{
	{"1MP", 1000, 1000},
	{"2MP", 1600, 1250},
	{"8MP", 3200, 2500},
	{"24MP", 6000, 4000},
}

// BenchmarkNewPlan measures everything expensive: keys, the partition and the interval list.
func BenchmarkNewPlan(b *testing.B) {
	for _, sz := range benchSizes {
		b.Run(sz.name, func(b *testing.B) {
			im := testutil.Gradient(sz.w, sz.h, 3)
			p := engine.DefaultParams()
			p.Angle = 33
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := engine.NewPlan(im, p, nil); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkPartitionRegions measures the region-aware partition against the plain one, because a region map must
// not make every live preview several times slower. The map is a grid of 64-pixel cells in a checker pattern with
// a second angle, so two angle groups are walked.
func BenchmarkPartitionRegions(b *testing.B) {
	for _, sz := range benchSizes[:3] { // 24 MP adds nothing the 8 MP row does not show
		cells := testutil.GridCells(sz.w, sz.h, 64)
		n := 0
		for _, c := range cells {
			n = max(n, int(c))
		}
		angle := 120
		r := &engine.Regions{
			Labels:  cells,
			ClassOf: testutil.ClassPattern(n, "checker", 1),
			Defs:    []engine.ClassDef{{}, {}, {Angle: &angle}},
		}
		b.Run(sz.name+"/plain", func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				_ = engine.Partition(sz.w, sz.h, 33)
			}
		})
		b.Run(sz.name+"/regions", func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				_ = engine.PartitionRegions(sz.w, sz.h, 33, r)
			}
		})
	}
}

// BenchmarkSort measures the instant sort alone; the plan is built outside the timed region.
func BenchmarkSort(b *testing.B) {
	for _, sz := range benchSizes {
		b.Run(sz.name, func(b *testing.B) {
			im := testutil.Gradient(sz.w, sz.h, 3)
			p := engine.DefaultParams()
			p.Angle = 33
			pl, err := engine.NewPlan(im, p, nil)
			if err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_ = pl.Sort()
			}
		})
	}
}
