package api_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/api"
)

func TestMaxPassesReachesTheResult(t *testing.T) {
	s := prepared(t)
	maxPasses, err := s.MaxPasses()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Reset(); err != nil {
		t.Fatal(err)
	}
	done := false
	for !done && s.Pass() < maxPasses {
		if done, err = s.Step(1); err != nil {
			t.Fatal(err)
		}
	}
	if !done {
		t.Fatalf("not done after MaxPasses %d", maxPasses)
	}
	stepped := slices.Clone(s.Pixels())
	if err := s.FinishInstant(); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(stepped, s.Pixels()) {
		t.Fatal("the last sampled frame differs from FinishInstant")
	}
}

func TestMaxPassesBeforePrepare(t *testing.T) {
	if _, err := api.NewSession().MaxPasses(); !errors.Is(err, api.ErrState) {
		t.Fatalf("got %v, want ErrState", err)
	}
	s := ready(t, 8, 8)
	if _, err := s.MaxPasses(); !errors.Is(err, api.ErrState) {
		t.Fatalf("before prepare: got %v, want ErrState", err)
	}
}
