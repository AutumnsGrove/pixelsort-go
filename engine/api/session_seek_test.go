package api_test

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"slices"
	"testing"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/engine/api"
)

// reference steps a fresh session n passes from the original, one pass at a time: the definition Seek must match.
func reference(t *testing.T, w, h int, recipe string, n int) ([]uint32, int) {
	t.Helper()
	s := ready(t, w, h)
	if err := s.Configure([]byte(recipe)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Prepare(); err != nil {
		t.Fatal(err)
	}
	if err := s.Reset(); err != nil {
		t.Fatal(err)
	}
	for s.Pass() < n {
		done, err := s.Step(1)
		if err != nil {
			t.Fatal(err)
		}
		if done {
			break
		}
	}
	return slices.Clone(s.Pixels()), s.Pass()
}

func seekRecipes() map[string]string {
	out := map[string]string{}
	for _, algo := range []string{"oddeven", "insertion", "merge", "reveal"} {
		out[algo] = fmt.Sprintf(`{"length":120,"angle":20,"algo":%q,"seed":5}`, algo)
	}
	out["wave"] = `{"mode":"wave","length":90,"angle":70,"algo":"oddeven"}`
	return out
}

// TestSeekEqualsStepping: for every algorithm, jumping to pass n (forwards, backwards, to the same place, past the
// end) gives exactly the pixels, and the pass count, of stepping n passes from the start.
func TestSeekEqualsStepping(t *testing.T) {
	const w, h = 40, 30
	for name, recipe := range seekRecipes() {
		t.Run(name, func(t *testing.T) {
			s := ready(t, w, h)
			if err := s.Configure([]byte(recipe)); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Prepare(); err != nil {
				t.Fatal(err)
			}
			_, total := reference(t, w, h, recipe, 1<<20)
			if total < 3 {
				t.Fatalf("recipe finishes in %d passes; too few to test seeking", total)
			}
			rng := rand.New(rand.NewPCG(7, uint64(len(name))))
			targets := []int{0, 1, total / 2, 2, total - 1, total / 2, total / 2, 0, total + 50}
			for range 12 {
				targets = append(targets, rng.IntN(total+3))
			}
			for _, n := range targets {
				if _, err := s.Seek(n); err != nil {
					t.Fatalf("Seek(%d): %v", n, err)
				}
				want, wantPass := reference(t, w, h, recipe, n)
				if s.Pass() != wantPass {
					t.Fatalf("Seek(%d): pass %d, want %d", n, s.Pass(), wantPass)
				}
				if !slices.Equal(s.Pixels(), want) {
					t.Fatalf("Seek(%d): pixels differ from stepping %d passes", n, n)
				}
			}
		})
	}
}

func TestSeekReportsDoneAndRunsOutOfPasses(t *testing.T) {
	s := prepared(t)
	_, total := reference(t, 40, 30, `{"length":200,"angle":20,"algo":"merge"}`, 1<<20)
	done, err := s.Seek(total + 100)
	if err != nil || !done {
		t.Fatalf("seek past the end: done %v err %v", done, err)
	}
	if s.Progress() != 1 {
		t.Fatalf("progress %v after seeking to the end", s.Progress())
	}
	done, err = s.Seek(0)
	if err != nil || done || s.Pass() != 0 || s.Progress() != 0 {
		t.Fatalf("seek to 0: done %v err %v pass %d progress %v", done, err, s.Pass(), s.Progress())
	}
	if !slices.Equal(s.Pixels(), mustOriginal(t)) {
		t.Fatal("seeking to pass 0 did not give back the original")
	}
}

func mustOriginal(t *testing.T) []uint32 {
	t.Helper()
	return slices.Clone(ready(t, 40, 30).Pixels())
}

func TestSeekStartsFromPreparedPlanWithoutReset(t *testing.T) {
	s := prepared(t) // prepared but never Reset
	if _, err := s.Seek(3); err != nil {
		t.Fatalf("seek after prepare: %v", err)
	}
	if s.Pass() != 3 {
		t.Fatalf("pass %d, want 3", s.Pass())
	}
}

func TestSeekErrors(t *testing.T) {
	s := ready(t, 8, 8)
	if _, err := s.Seek(1); !errors.Is(err, api.ErrState) {
		t.Fatalf("seek before prepare: %v", err)
	}
	p := prepared(t)
	if _, err := p.Seek(-1); err == nil {
		t.Fatal("negative pass accepted")
	}
	if _, err := p.Seek(api.MaxSeekPass + 1); err == nil {
		t.Fatal("pass beyond MaxSeekPass accepted")
	}
}

// A seek must not disturb a later Step: stepping carries on from where the seek stopped.
func TestStepAfterSeekContinues(t *testing.T) {
	s := prepared(t)
	if _, err := s.Seek(4); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Step(3); err != nil {
		t.Fatal(err)
	}
	want, wantPass := reference(t, 40, 30, `{"length":200,"angle":20,"algo":"merge"}`, 7)
	if s.Pass() != wantPass || !slices.Equal(s.Pixels(), want) {
		t.Fatalf("seek(4)+step(3) is not pass 7 (pass %d)", s.Pass())
	}
}

func BenchmarkSeekMiddle2MP(b *testing.B) {
	const w, h = 1600, 1250 // 2 MP
	s := api.NewSession()
	if err := s.Init(w, h); err != nil {
		b.Fatal(err)
	}
	img := make([]byte, w*h*4)
	r := rand.New(rand.NewPCG(1, 2))
	for i := range img {
		img[i] = byte(r.UintN(256))
	}
	if err := s.SetImage(img); err != nil {
		b.Fatal(err)
	}
	for _, algo := range []string{"oddeven", "insertion", "merge", "reveal"} {
		b.Run(algo, func(b *testing.B) {
			if err := s.Configure([]byte(fmt.Sprintf(`{"algo":%q,"length":80}`, algo))); err != nil {
				b.Fatal(err)
			}
			if _, err := s.Prepare(); err != nil {
				b.Fatal(err)
			}
			if _, err := s.Seek(api.MaxSeekPass); err != nil { // run to the end to learn how many passes there are
				b.Fatal(err)
			}
			total := s.Pass()
			b.ReportMetric(float64(total), "passes")
			// What a person dragging the slider does: jump to arbitrary passes, forwards and back. The slowest single seek
			// matters most (the target is under 300 ms), so report it as well as the mean.
			rng := rand.New(rand.NewPCG(3, 4))
			var worst time.Duration
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				start := time.Now()
				if _, err := s.Seek(rng.IntN(total + 1)); err != nil {
					b.Fatal(err)
				}
				worst = max(worst, time.Since(start))
			}
			b.ReportMetric(float64(worst.Milliseconds()), "worst-ms")
		})
	}
}

// TestSeekAcrossThinnedCheckpoints: a long sort fills the checkpoint cache and thins it (doubling the stride); seeks in every
// direction must still equal stepping from the start.
func TestSeekAcrossThinnedCheckpoints(t *testing.T) {
	const w, h = 1200, 3
	for _, algo := range []string{"insertion", "oddeven"} {
		t.Run(algo, func(t *testing.T) {
			recipe := fmt.Sprintf(`{"mode":"none","length":1000,"angle":0,"algo":%q}`, algo)
			_, total := reference(t, w, h, recipe, 1<<20)
			if total < 700 {
				t.Fatalf("only %d passes; need more than 16 checkpoints' worth to force thinning", total)
			}
			s := ready(t, w, h)
			if err := s.Configure([]byte(recipe)); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Prepare(); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Seek(total); err != nil { // one long run forwards fills and thins the cache
				t.Fatal(err)
			}
			for _, n := range []int{total - 1, 31, 32, 33, total / 2, 500, 1, total / 3, total - 5, 0, 700, 64, 65} {
				if _, err := s.Seek(n); err != nil {
					t.Fatalf("Seek(%d): %v", n, err)
				}
				want, wantPass := reference(t, w, h, recipe, n)
				if s.Pass() != wantPass || !slices.Equal(s.Pixels(), want) {
					t.Fatalf("Seek(%d): pass %d (want %d) or pixels differ", n, s.Pass(), wantPass)
				}
			}
		})
	}
}

// Changing the recipe drops the checkpoints: a seek after Configure+Prepare must reflect the new plan, not an old one.
func TestSeekAfterReconfigureUsesTheNewPlan(t *testing.T) {
	s := prepared(t)
	if _, err := s.Seek(40); err != nil { // leaves checkpoints behind for the first recipe
		t.Fatal(err)
	}
	const second = `{"length":120,"angle":70,"algo":"oddeven","seed":9}`
	if err := s.Configure([]byte(second)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Prepare(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Seek(35); err != nil {
		t.Fatal(err)
	}
	want, wantPass := reference(t, 40, 30, second, 35)
	if s.Pass() != wantPass || !slices.Equal(s.Pixels(), want) {
		t.Fatal("seek after reconfigure used the old plan's checkpoints")
	}
}
