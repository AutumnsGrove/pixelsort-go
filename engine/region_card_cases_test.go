package engine_test

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// TestRegionCardCases checks the table shared with the TypeScript tests (web/src/lib/region-cards.test.ts loads the same
// file): every ClassDef the card model produces must decode strictly (no unknown field) and, laid over the default
// recipe, give a recipe the engine accepts.
func TestRegionCardCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/region-card-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name     string          `json:"name"`
		ClassDef json.RawMessage `json:"classDef"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			var def engine.ClassDef
			dec := json.NewDecoder(bytes.NewReader(tc.ClassDef))
			dec.DisallowUnknownFields()
			if err := dec.Decode(&def); err != nil {
				t.Fatalf("decode %s: %v", tc.ClassDef, err)
			}
			if err := engine.DefaultParams().With(def).Validate(); err != nil {
				t.Fatalf("%s over the defaults is not a valid recipe: %v", tc.ClassDef, err)
			}
		})
	}
}
