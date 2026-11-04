package engine_test

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
	"pgregory.net/rapid"
)

func TestDefaultParamsValid(t *testing.T) {
	p := engine.DefaultParams()
	if err := p.Validate(); err != nil {
		t.Fatalf("DefaultParams does not validate: %v", err)
	}
	want := engine.Params{
		Mode: engine.ModeRandom, Key: engine.KeyLuma, Angle: 0, Length: 83, Randomness: 10,
		WaveAmp: 70, WavePeriod: 0, Lo: 51, Hi: 209, ThresholdKey: engine.KeyLuma, Edge: 26,
		Rule: 110, Cell: 8, CASpace: engine.CASpaceImage, CABoundary: engine.CABoundaryRandom,
		Algo: engine.AlgoOddEven, Seed: 7,
	}
	if p != want {
		t.Errorf("DefaultParams() = %+v, want %+v", p, want)
	}
}

func TestValidateRejects(t *testing.T) {
	tests := []struct {
		name  string
		field string
		edit  func(*engine.Params)
	}{
		{"angle below zero", "angle", func(p *engine.Params) { p.Angle = -1 }},
		{"angle above 359", "angle", func(p *engine.Params) { p.Angle = 360 }},
		{"length zero", "length", func(p *engine.Params) { p.Length = 0 }},
		{"length 1001", "length", func(p *engine.Params) { p.Length = 1001 }},
		{"randomness above 100", "randomness", func(p *engine.Params) { p.Randomness = 101 }},
		{"threshold band backwards", "lo", func(p *engine.Params) { p.Lo, p.Hi = 200, 100 }},
		{"unknown mode", "mode", func(p *engine.Params) { p.Mode = "bogus" }},
		{"empty key", "key", func(p *engine.Params) { p.Key = "" }},
		{"unknown algorithm", "algo", func(p *engine.Params) { p.Algo = "quick" }},
		{"edge above 255", "edge", func(p *engine.Params) { p.Edge = 256 }},
		{"rule above 255", "rule", func(p *engine.Params) { p.Rule = 256 }},
		{"cell zero", "cell", func(p *engine.Params) { p.Cell = 0 }},
		{"wave amplitude above 100", "waveAmp", func(p *engine.Params) { p.WaveAmp = 101 }},
		{"negative wave period", "wavePeriod", func(p *engine.Params) { p.WavePeriod = -1 }},
		{"unknown ca space", "caSpace", func(p *engine.Params) { p.CASpace = "x" }},
		{"unknown ca boundary", "caBoundary", func(p *engine.Params) { p.CABoundary = "x" }},
		{"unknown threshold key", "thresholdKey", func(p *engine.Params) { p.ThresholdKey = "nope" }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := engine.DefaultParams()
			tc.edit(&p)
			err := p.Validate()
			if !errors.Is(err, engine.ErrInvalidParams) {
				t.Fatalf("Validate() = %v, want ErrInvalidParams", err)
			}
			if !strings.Contains(err.Error(), tc.field) {
				t.Errorf("error %q does not name the field %q", err, tc.field)
			}
		})
	}
}

func TestParsePartialKeepsDefaults(t *testing.T) {
	p, err := engine.ParseParams([]byte(`{"angle":45}`))
	if err != nil {
		t.Fatal(err)
	}
	want := engine.DefaultParams()
	want.Angle = 45
	if p != want {
		t.Errorf("ParseParams = %+v, want %+v", p, want)
	}
}

func TestParseEmptyObjectIsDefaults(t *testing.T) {
	p, err := engine.ParseParams([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if p != engine.DefaultParams() {
		t.Errorf("ParseParams({}) = %+v", p)
	}
}

func TestParseRejectsUnknownField(t *testing.T) {
	if _, err := engine.ParseParams([]byte(`{"angle":45,"colour":1}`)); err == nil {
		t.Fatal("ParseParams accepted an unknown field")
	}
}

func TestParseRejectsTrailingData(t *testing.T) {
	if _, err := engine.ParseParams([]byte(`{} {}`)); err == nil {
		t.Fatal("ParseParams accepted trailing data")
	}
}

func TestParseRejectsWrongType(t *testing.T) {
	if _, err := engine.ParseParams([]byte(`{"angle":"x"}`)); err == nil {
		t.Fatal("ParseParams accepted a string for angle")
	}
}

func TestParseRejectsInvalid(t *testing.T) {
	if _, err := engine.ParseParams([]byte(`{"angle":400}`)); !errors.Is(err, engine.ErrInvalidParams) {
		t.Fatalf("error = %v, want ErrInvalidParams", err)
	}
}

func TestWith(t *testing.T) {
	base := engine.DefaultParams()
	angle, key, length := 137, engine.KeyHue, 42
	got := base.With(engine.ClassDef{Angle: &angle, Key: &key, Length: &length})
	if got.Angle != 137 || got.Key != engine.KeyHue || got.Length != 42 {
		t.Errorf("With did not apply the overrides: %+v", got)
	}
	if got.Seed != base.Seed || got.Mode != base.Mode || got.Edge != base.Edge {
		t.Errorf("With changed a field it was not given: %+v", got)
	}
	if got := base.With(engine.ClassDef{}); got != base {
		t.Errorf("an empty ClassDef changed the params: %+v", got)
	}
	if base.Angle != 0 {
		t.Errorf("With mutated its receiver")
	}
}

func TestProp_ParamsJSONRoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		p := testutil.ParamsGen().Draw(t, "params")
		data, err := json.Marshal(p)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		got, err := engine.ParseParams(data)
		if err != nil {
			t.Fatalf("parse %s: %v", data, err)
		}
		if got != p {
			t.Fatalf("round trip changed the params:\n got %+v\nwant %+v", got, p)
		}
	})
}
