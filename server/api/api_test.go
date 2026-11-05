package api_test

import (
	"net/http/httptest"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/server/api"
)

// TestEveryRouteIsDocumented keeps docs/api.md from rotting: each registered route must appear as a heading.
func TestEveryRouteIsDocumented(t *testing.T) {
	doc, err := os.ReadFile("../../docs/api.md")
	if err != nil {
		t.Fatal(err)
	}
	headings := regexp.MustCompile("(?m)^### `([A-Z]+ [^`]+)`").FindAllStringSubmatch(string(doc), -1)
	documented := map[string]bool{}
	for _, h := range headings {
		documented[h[1]] = true
	}
	routes := api.New(api.Deps{}).Routes()
	for _, r := range routes {
		if !documented[r] {
			t.Errorf("route %q is not in docs/api.md", r)
		}
	}
	for d := range documented {
		found := false
		for _, r := range routes {
			found = found || r == d
		}
		if !found {
			t.Errorf("docs/api.md documents %q, which is not a route", d)
		}
	}
}

// TestRecipeKeysMatchTheEngine fails when engine.Params gains or loses a field the server's allow-list does not know:
// the server never imports the engine, so this test is what keeps the list honest.
func TestRecipeKeysMatchTheEngine(t *testing.T) {
	var fromEngine []string
	typ := reflect.TypeOf(engine.Params{})
	for i := 0; i < typ.NumField(); i++ {
		fromEngine = append(fromEngine, strings.Split(typ.Field(i).Tag.Get("json"), ",")[0])
	}
	allowed := api.RecipeKeys()
	for _, k := range fromEngine {
		if !allowed[k] {
			t.Errorf("engine.Params has %q but the server's recipe allow-list does not", k)
		}
	}
	if len(allowed) != len(fromEngine) {
		t.Errorf("allow-list has %d keys, engine.Params has %d", len(allowed), len(fromEngine))
	}
}

func TestHealthzNeedsNoDatabase(t *testing.T) {
	h := api.New(api.Deps{}).Handler() // every dependency is nil: /healthz must not touch any of them
	rec := httptest.NewRecorder()
	start := time.Now()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"status":"ok"`) || time.Since(start) > 50*time.Millisecond {
		t.Fatalf("%d %s in %v", rec.Code, rec.Body, time.Since(start))
	}
}
