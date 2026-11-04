package engine_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// TestParamsCases checks the table shared with the TypeScript tests: both languages must accept and reject the
// same recipes (web/src/lib/engine/params.test.ts loads the same file).
func TestParamsCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/params-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name  string `json:"name"`
		JSON  string `json:"json"`
		Valid bool   `json:"valid"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			_, err := engine.ParseParams([]byte(tc.JSON))
			if (err == nil) != tc.Valid {
				t.Fatalf("ParseParams(%s) error = %v, want valid = %v", tc.JSON, err, tc.Valid)
			}
		})
	}
}
