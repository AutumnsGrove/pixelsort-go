package engine_test

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// TestBuiltInPresetsRollToValidParams loads the web app's presets.json (the single source of the eight built-ins) and
// checks that every value a preset can roll, at both ends of every range and at every pick, makes valid Params.
func TestBuiltInPresetsRollToValidParams(t *testing.T) {
	raw, err := os.ReadFile("../web/src/lib/presets.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Presets []struct {
			ID   string                     `json:"id"`
			Spec map[string]json.RawMessage `json:"spec"`
		} `json:"presets"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Presets) != 8 {
		t.Fatalf("%d presets, want 8", len(file.Presets))
	}
	for _, p := range file.Presets {
		// candidates[k] lists every value the field can take.
		candidates := map[string][]any{}
		for k, v := range p.Spec {
			var arr []float64
			var pick struct{ Pick []any }
			var around struct{ Around []float64 }
			switch {
			case json.Unmarshal(v, &arr) == nil:
				step := 1.0
				if len(arr) > 2 {
					step = arr[2]
				}
				n := int(math.Floor((arr[1]-arr[0])/step + 1e-9))
				candidates[k] = []any{arr[0], arr[0] + float64(n)*step}
			case json.Unmarshal(v, &pick) == nil && pick.Pick != nil:
				candidates[k] = pick.Pick
			case json.Unmarshal(v, &around) == nil && around.Around != nil:
				candidates[k] = []any{around.Around[0]}
			default:
				var one any
				_ = json.Unmarshal(v, &one)
				candidates[k] = []any{one}
			}
		}
		// Try each candidate of each field with every other field at its first candidate.
		for field, vals := range candidates {
			for _, val := range vals {
				// The web app's base recipe fills every owned field the preset leaves out.
				recipe := map[string]any{"lo": 51.0, "hi": 209.0}
				for k, c := range candidates {
					recipe[k] = c[0]
					if f, ok := recipe[k].(float64); ok {
						recipe[k] = math.Round(f)
					}
				}
				if f, ok := val.(float64); ok {
					val = math.Round(f)
				}
				recipe[field] = val
				if lo, ok := recipe["lo"].(float64); ok {
					if hi, ok := recipe["hi"].(float64); ok && lo > hi-13 {
						recipe["lo"] = math.Max(0, hi-38) // the same rule as the web roll()
					}
				}
				data, _ := json.Marshal(recipe)
				if _, err := engine.ParseParams(data); err != nil {
					t.Errorf("preset %s, %s=%v: %v (%s)", p.ID, field, val, err, data)
				}
			}
		}
	}
}
