package masks_test

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/masks"
)

// TestSpecCases loads the table shared with the TypeScript tests (web/src/lib/mask-model.test.ts): the Spec that the
// TypeScript serialiser produces must decode strictly here and rasterise to what the case says.
func TestSpecCases(t *testing.T) {
	raw, err := os.ReadFile("../testdata/mask-spec-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name         string          `json:"name"`
		Spec         json.RawMessage `json:"spec"`
		CentreFrozen bool            `json:"centreFrozen"`
		CornerFrozen bool            `json:"cornerFrozen"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	const n = 60
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			var spec masks.Spec
			dec := json.NewDecoder(bytes.NewReader(tc.Spec))
			dec.DisallowUnknownFields()
			if err := dec.Decode(&spec); err != nil {
				t.Fatalf("decode %s: %v", tc.Spec, err)
			}
			plane := masks.Rasterize(n, n, spec)
			if len(plane) != n*n {
				t.Fatalf("plane has %d pixels, want %d", len(plane), n*n)
			}
			if got := plane[(n/2)*n+n/2] == 1; got != tc.CentreFrozen {
				t.Errorf("centre frozen = %v, want %v", got, tc.CentreFrozen)
			}
			if got := plane[0] == 1; got != tc.CornerFrozen {
				t.Errorf("corner frozen = %v, want %v", got, tc.CornerFrozen)
			}
		})
	}
}
