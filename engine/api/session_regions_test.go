package api_test

import (
	"errors"
	"math"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/api"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

const hexSpec = `{"shape":"hexagon","size":90,"gap":6,"rotate":0,"seed":3,"pattern":"checker"}`
const hexDefs = `[{},{"frozen":true},{"angle":100}]`

func TestSetTilingBuildsRegions(t *testing.T) {
	s := ready(t, 160, 100)
	if err := s.SetTiling([]byte(hexSpec), []byte(hexDefs)); err != nil {
		t.Fatal(err)
	}
	if s.Labels() == nil || len(s.Labels()) != 160*100 || len(s.ClassOf()) < 3 {
		t.Fatalf("labels %d, classes %d", len(s.Labels()), len(s.ClassOf()))
	}
	_ = s.Configure([]byte(`{"mode":"none","randomness":0}`))
	st, err := s.Prepare()
	if err != nil || st.FrozenPixels == 0 || st.Intervals == 0 {
		t.Fatalf("stats %+v err %v", st, err)
	}
	if err := s.SetTiling(nil, nil); err != nil || s.Labels() != nil {
		t.Fatalf("clear: %v", err)
	}
}

func TestSetTilingRejectsBadInput(t *testing.T) {
	s := ready(t, 40, 40)
	for name, spec := range map[string]string{
		"unknown shape": `{"shape":"blob","size":100,"pattern":"all"}`,
		"unknown field": `{"shape":"square","size":100,"pattern":"all","bogus":1}`,
		"not json":      `{`,
		"trailing":      `{"shape":"square","size":100,"pattern":"all"} x`,
	} {
		if err := s.SetTiling([]byte(spec), nil); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if err := s.SetTiling([]byte(hexSpec), []byte(`not json`)); err == nil {
		t.Error("bad class definitions accepted")
	}
	if err := api.NewSession().SetTiling([]byte(hexSpec), nil); !errors.Is(err, api.ErrState) {
		t.Errorf("before init: %v", err)
	}
}

func TestSetMaskSpecFreezesAndFeathers(t *testing.T) {
	s := ready(t, 60, 40)
	spec := `{"objects":[{"kind":"rect","cx":0.5,"cy":0.5,"w":0.5,"h":1,"mode":"add"}],"feather":0.05}`
	if err := s.SetMaskSpec([]byte(spec)); err != nil {
		t.Fatal(err)
	}
	_ = s.Configure([]byte(`{}`))
	st, err := s.Prepare()
	if err != nil || st.FrozenPixels != 30*40 {
		t.Fatalf("frozen %d err %v, want %d", st.FrozenPixels, err, 30*40)
	}
	for _, bad := range []string{`{"feather":0.9}`, `{"objects":[{"kind":"rect","extra":1}]}`, `[`} {
		if err := s.SetMaskSpec([]byte(bad)); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
	if err := s.SetMaskSpec(nil); err != nil {
		t.Fatal(err)
	}
	if st, _ := s.Prepare(); st.FrozenPixels != 0 {
		t.Fatal("clearing the mask spec left frozen pixels")
	}
}

func TestBrightestSpotAndSortable(t *testing.T) {
	s := ready(t, 50, 30)
	cx, cy, w, h, err := s.BrightestSpot()
	if err != nil || cx < 0 || cx > 1 || cy < 0 || cy > 1 || w <= 0 || h <= 0 {
		t.Fatalf("%v %v %v %v %v", cx, cy, w, h, err)
	}
	if _, err := s.Sortable(); !errors.Is(err, api.ErrState) {
		t.Fatalf("sortable before prepare: %v", err)
	}
	_ = s.Configure([]byte(`{"mode":"threshold","lo":100,"hi":200}`))
	st, _ := s.Prepare()
	m, err := s.Sortable()
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, v := range m {
		n += int(v)
	}
	if n != st.SortablePixels {
		t.Fatalf("sortable marks %d pixels, the plan says %d", n, st.SortablePixels)
	}
}

// The spec is vector, so a full-resolution export has the same character as the preview: about the same number of cells
// and the same share of the picture in each class.
func TestFullResolutionHasTheSameCharacter(t *testing.T) {
	measure := func(w, h int) (cells int, classShare [4]float64) {
		s := api.NewSession()
		if err := s.Init(w, h); err != nil {
			t.Fatal(err)
		}
		if err := s.SetImage(testutil.Gradient(w, h, 1).RGBA()); err != nil {
			t.Fatal(err)
		}
		if err := s.SetTiling([]byte(hexSpec), []byte(hexDefs)); err != nil {
			t.Fatal(err)
		}
		labels, classOf := s.Labels(), s.ClassOf()
		for _, l := range labels {
			classShare[classOf[l]] += 1 / float64(len(labels))
		}
		return len(classOf) - 1, classShare
	}
	c1, a := measure(640, 400)
	c2, b := measure(1280, 800)
	if math.Abs(float64(c1-c2)) > 0.05*float64(c1) {
		t.Fatalf("%d cells at 640 px but %d at 1280 px", c1, c2)
	}
	for k := range a {
		if math.Abs(a[k]-b[k]) > 0.03 {
			t.Fatalf("class %d covers %.3f at 640 px but %.3f at 1280 px", k, a[k], b[k])
		}
	}
}
