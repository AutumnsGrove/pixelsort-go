package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// benchStepPass measures one Step on a stepper that is mid-sort: a fresh stepper is made when the previous one
// finishes, so every measured pass is a real one.
func benchStepPass(b *testing.B, algo engine.Algo) {
	for _, sz := range benchSizes {
		b.Run(sz.name, func(b *testing.B) {
			p := engine.DefaultParams()
			p.Angle, p.Length, p.Algo, p.Randomness = 30, 50, algo, 0
			pl, err := engine.NewPlan(testutil.Gradient(sz.w, sz.h, 3), p, nil)
			if err != nil {
				b.Fatal(err)
			}
			s := pl.NewStepper()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if s.Step() {
					b.StopTimer()
					s = pl.NewStepper()
					b.StartTimer()
				}
			}
		})
	}
}

func BenchmarkStepPassOddEven(b *testing.B)   { benchStepPass(b, engine.AlgoOddEven) }
func BenchmarkStepPassInsertion(b *testing.B) { benchStepPass(b, engine.AlgoInsertion) }
func BenchmarkStepPassMerge(b *testing.B)     { benchStepPass(b, engine.AlgoMerge) }
func BenchmarkStepPassReveal(b *testing.B)    { benchStepPass(b, engine.AlgoReveal) }
