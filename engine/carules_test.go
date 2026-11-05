package engine_test

import (
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

func TestEveryRecommendedRuleHasANote(t *testing.T) {
	seen := map[uint8]bool{}
	for _, r := range engine.RecommendedRules {
		if seen[r] {
			t.Errorf("rule %d listed twice", r)
		}
		seen[r] = true
		if note, ok := engine.RuleNote(r); !ok || note == "" {
			t.Errorf("rule %d has no note", r)
		}
	}
}

func TestRuleNoteUnknownRule(t *testing.T) {
	if note, ok := engine.RuleNote(1); ok || note != "" {
		t.Fatalf("got %q, %v", note, ok)
	}
}

func TestPickRecommended(t *testing.T) {
	hit := map[uint8]bool{}
	for seed := uint32(0); seed < 1000; seed++ {
		r := engine.PickRecommended(seed)
		if r != engine.PickRecommended(seed) {
			t.Fatal("not deterministic")
		}
		if !slices.Contains(engine.RecommendedRules[:], r) {
			t.Fatalf("picked %d, which is not recommended", r)
		}
		hit[r] = true
	}
	if len(hit) != len(engine.RecommendedRules) {
		t.Fatalf("1000 seeds hit %d of %d rules", len(hit), len(engine.RecommendedRules))
	}
}
