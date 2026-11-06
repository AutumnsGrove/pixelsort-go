package server_test

import (
	"strings"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/server"
)

func TestHelperRouteExistsOnlyWhenConfigured(t *testing.T) {
	off := newSite(t, nil)
	res, body := off.do("POST", "/api/helper", map[string]any{})
	if res.StatusCode != 404 {
		t.Fatalf("an unconfigured helper must not exist: %d %s", res.StatusCode, body)
	}

	const key = "sk-or-TEST-KEY-never-shown"
	on := newSite(t, func(c *server.Config) { c.HelperKey = key; c.HelperModel = server.DefaultHelperModel })
	res, body = on.do("GET", "/api/features", nil)
	on.expect(res, body, 200)
	if !strings.Contains(string(body), `"helper":true`) {
		t.Fatalf("features: %s", body)
	}
	res, body = on.do("POST", "/api/helper", map[string]any{}) // JSON, not a form: refused before any model is asked
	if res.StatusCode != 400 {
		t.Fatalf("a bad request is a 400, got %d %s", res.StatusCode, body)
	}
	for _, path := range []string{"/api/features", "/api/helper", "/api/version", "/"} {
		_, b := on.do("GET", path, nil)
		if strings.Contains(string(b), key) {
			t.Fatalf("%s leaked the key", path)
		}
	}
}
