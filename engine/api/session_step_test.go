package api_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/api"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

func prepared(t *testing.T) *api.Session {
	t.Helper()
	s := ready(t, 40, 30)
	if err := s.Configure([]byte(`{"length":200,"angle":20,"algo":"merge"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Prepare(); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestStepToDoneEqualsInstant(t *testing.T) {
	s := prepared(t)
	if err := s.Reset(); err != nil {
		t.Fatal(err)
	}
	done := false
	for i := 0; i < 1000 && !done; i++ {
		var err error
		if done, err = s.Step(3); err != nil {
			t.Fatal(err)
		}
	}
	if !done || s.Progress() != 1 {
		t.Fatalf("done %v progress %v", done, s.Progress())
	}
	stepped := slices.Clone(s.Pixels())
	if err := s.FinishInstant(); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(stepped, s.Pixels()) {
		t.Fatal("stepped result differs from FinishInstant")
	}
}

func TestStepStopsEarlyAtDone(t *testing.T) {
	s := prepared(t)
	_ = s.Reset()
	done, err := s.Step(api.MaxStepsPerCall)
	if err != nil || !done {
		t.Fatalf("done %v err %v", done, err)
	}
	if s.Pass() >= api.MaxStepsPerCall {
		t.Fatalf("ran %d passes instead of stopping at done", s.Pass())
	}
}

func TestResetReturnsOriginal(t *testing.T) {
	s := prepared(t)
	_ = s.Reset()
	_, _ = s.Step(2)
	if err := s.Reset(); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(s.Pixels(), testutil.Gradient(40, 30, 3).Pix) || s.Pass() != 0 || s.Progress() != 0 {
		t.Fatal("Reset did not return to the original")
	}
}

func TestStepOutOfOrderAndRange(t *testing.T) {
	s := prepared(t)
	if _, err := s.Step(1); !errors.Is(err, api.ErrState) {
		t.Fatalf("step before reset: %v", err)
	}
	if err := api.NewSession().Reset(); !errors.Is(err, api.ErrState) {
		t.Fatalf("reset before prepare: %v", err)
	}
	_ = s.Reset()
	for _, n := range []int{0, -1, api.MaxStepsPerCall + 1} {
		if _, err := s.Step(n); err == nil {
			t.Errorf("step(%d) accepted", n)
		}
	}
	_ = s.Configure([]byte(`{}`)) // invalidates the plan and the stepper
	if _, err := s.Step(1); !errors.Is(err, api.ErrState) {
		t.Fatalf("step after configure: %v", err)
	}
}
