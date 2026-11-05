package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// BenchmarkCAGrid measures the automaton alone, for a grid the size of an 8 MP image at the default cell size.
func BenchmarkCAGrid(b *testing.B) {
	cw, ch := 3200/26+1, 2500/26+1
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		engine.CAGrid(cw, ch, 110, engine.CABoundaryRandom, 7)
	}
}

// BenchmarkNewPlanCA is a whole plan with ca intervals at 8 MP, to compare with BenchmarkNewPlan.
func BenchmarkNewPlanCA(b *testing.B) {
	im := testutil.Gradient(3200, 2500, 3)
	for _, space := range []string{engine.CASpaceImage, engine.CASpaceLine} {
		b.Run(space, func(b *testing.B) {
			p := engine.DefaultParams()
			p.Mode, p.Angle, p.CASpace = engine.ModeCA, 33, space
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				if _, err := engine.NewPlan(im, p, nil); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
