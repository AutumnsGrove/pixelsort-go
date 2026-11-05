package api_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/engine/api"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// recipe45 is the "random-45" golden recipe.
func recipe45() []byte {
	p := engine.DefaultParams()
	p.Angle, p.Length, p.Seed = 45, 60, 2
	b, err := json.Marshal(p)
	if err != nil {
		panic(err) // a Params always marshals; a failure here is a bug in the test
	}
	return b
}

func ready(t *testing.T, w, h int) *api.Session {
	t.Helper()
	s := api.NewSession()
	if err := s.Init(w, h); err != nil {
		t.Fatal(err)
	}
	if err := s.SetImage(testutil.Gradient(w, h, 3).RGBA()); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestLifecycleOutOfOrder(t *testing.T) {
	tests := []struct {
		name string
		call func(*api.Session) error
	}{
		{"set image before init", func(s *api.Session) error { return s.SetImage(make([]byte, 4)) }},
		{"set regions before init", func(s *api.Session) error { return s.SetRegions(nil, nil, nil) }},
		{"set mask before init", func(s *api.Session) error { return s.SetMask(nil) }},
		{"set soft before init", func(s *api.Session) error { return s.SetSoft(1) }},
		{"configure before init", func(s *api.Session) error { return s.Configure([]byte(`{}`)) }},
		{"prepare before configure", func(s *api.Session) error { _ = s.Init(2, 2); _, err := s.Prepare(); return err }},
		{"finish before prepare", func(s *api.Session) error { _ = s.Init(2, 2); return s.FinishInstant() }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.call(api.NewSession()); !errors.Is(err, api.ErrState) {
				t.Fatalf("got %v, want ErrState", err)
			}
		})
	}
}

func TestInstantMatchesEngine(t *testing.T) {
	s := ready(t, 97, 61)
	if err := s.Configure(recipe45()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Prepare(); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishInstant(); err != nil {
		t.Fatal(err)
	}
	im := &engine.Image{W: 97, H: 61, Pix: s.Pixels()}
	sum := sha256.Sum256(im.RGBA())
	want, err := os.ReadFile("../testdata/golden/random-45.sha256")
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(sum[:]); got != strings.TrimSpace(string(want)) {
		t.Fatalf("hash %s, want %s", got, want)
	}
}

func TestConfigureInvalidatesPlan(t *testing.T) {
	s := ready(t, 8, 8)
	_ = s.Configure([]byte(`{}`))
	if _, err := s.Prepare(); err != nil {
		t.Fatal(err)
	}
	_ = s.Configure([]byte(`{"seed":5}`))
	if err := s.FinishInstant(); !errors.Is(err, api.ErrState) {
		t.Fatalf("got %v, want ErrState", err)
	}
}

func TestBadInputs(t *testing.T) {
	s := ready(t, 4, 4)
	if err := s.SetImage(make([]byte, 5)); err == nil {
		t.Error("wrong image length accepted")
	}
	if err := s.SetMask(make([]uint8, 3)); err == nil {
		t.Error("wrong mask length accepted")
	}
	if err := s.SetRegions(make([]uint16, 3), []uint8{0}, []byte(`[{}]`)); err == nil {
		t.Error("wrong label count accepted")
	}
	if err := s.SetRegions(make([]uint16, 16), []uint8{0}, []byte(`not json`)); err == nil {
		t.Error("bad defs accepted")
	}
	if err := s.SetRegions(make([]uint16, 16), []uint8{5}, []byte(`[{}]`)); err == nil {
		t.Error("class outside defs accepted")
	}
	if err := s.Configure([]byte(`{"angle":400}`)); err == nil {
		t.Error("bad angle accepted")
	}
	if err := s.Init(0, 5); err == nil {
		t.Error("zero size accepted")
	}
	if err := s.SetSoft(-1); err == nil {
		t.Error("negative feather accepted")
	}
}

func TestReinitReplacesState(t *testing.T) {
	s := ready(t, 8, 8)
	_ = s.Configure([]byte(`{}`))
	_, _ = s.Prepare()
	_ = s.FinishInstant()
	if err := s.Init(3, 2); err != nil {
		t.Fatal(err)
	}
	if w, h := s.Size(); w != 3 || h != 2 || len(s.Pixels()) != 6 {
		t.Fatalf("size %dx%d with %d pixels", w, h, len(s.Pixels()))
	}
	if err := s.FinishInstant(); !errors.Is(err, api.ErrState) {
		t.Fatalf("plan survived Init: %v", err)
	}
}

func TestMaskFreezesAndRegionsWork(t *testing.T) {
	s := ready(t, 20, 10)
	mask := make([]uint8, 200)
	for i := 0; i < 100; i++ {
		mask[i] = 1
	}
	if err := s.SetMask(mask); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSoft(2); err != nil {
		t.Fatal(err)
	}
	_ = s.Configure([]byte(`{"length":500}`))
	st, err := s.Prepare()
	if err != nil || st.FrozenPixels != 100 {
		t.Fatalf("stats %+v err %v", st, err)
	}
	if err := s.SetRegions(testutil.GridCells(20, 10, 5), testutil.ClassPattern(8, "checker", 1), []byte(`[{},{"frozen":true},{"reverse":true}]`)); err != nil {
		t.Fatal(err)
	}
	_ = s.Configure([]byte(`{}`))
	if _, err := s.Prepare(); err != nil {
		t.Fatal(err)
	}
	if err := s.SetRegions(nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMask(nil); err != nil {
		t.Fatal(err)
	}
}

func TestVersion(t *testing.T) {
	if api.Version() != engine.EngineVersion {
		t.Fatal("version mismatch")
	}
}
