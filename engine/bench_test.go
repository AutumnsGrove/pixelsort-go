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
