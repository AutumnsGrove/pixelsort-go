package api_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/api"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// FuzzSession drives a session with a random script of calls: nothing may panic and a finished sort is always a
// permutation of the image that was set.
func FuzzSession(f *testing.F) {
	f.Add([]byte{0, 1, 3, 4, 5})
	f.Add([]byte{5, 4, 3, 2, 1, 0, 9, 9})
	f.Add([]byte{0, 2, 6, 3, 4, 5, 3, 4, 5})
	f.Fuzz(func(t *testing.T, script []byte) {
		const w, h = 13, 7
		s := api.NewSession()
		var set []uint32
		for i, op := range script {
			if i > 64 {
				break
			}
			switch op % 8 {
			case 0:
				_ = s.Init(w, h)
				set = nil
			case 1:
				im := testutil.Gradient(w, h, uint32(op))
				if s.SetImage(im.RGBA()) == nil {
					set = slices.Clone(im.Pix)
				}
			case 2:
				_ = s.SetMask(make([]uint8, w*h/2))
			case 3:
				_ = s.Configure([]byte(`{"length":40,"seed":` + string(rune('0'+op%10)) + `}`))
			case 4:
				_, _ = s.Prepare()
			case 5:
				if s.FinishInstant() == nil && set != nil {
					got, want := slices.Clone(s.Pixels()), slices.Clone(set)
					slices.Sort(got)
					slices.Sort(want)
					if !slices.Equal(got, want) {
						t.Fatal("result is not a permutation of the image")
					}
				}
			case 6:
				_ = s.SetSoft(int(op % 5))
			case 7:
				_ = s.SetRegions(nil, nil, nil)
			}
		}
	})
}
