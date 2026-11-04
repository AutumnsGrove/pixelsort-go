package server

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadConfigDefaults(t *testing.T) {
	c, err := LoadConfig(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != "127.0.0.1:8895" || c.DataDir != "./data" || c.BudgetGB != 50 || c.MaxUploadMB != 200 || c.TrashDays != 7 || c.LogFormat != "text" || c.Deployment != "dev" {
		t.Fatalf("defaults: %+v", c)
	}
	if c.BudgetBytes() != 50<<30 || c.MaxUploadBytes() != 200<<20 {
		t.Fatalf("bytes: %d %d", c.BudgetBytes(), c.MaxUploadBytes())
	}
}

func TestLoadConfigOverrides(t *testing.T) {
	c, err := LoadConfig(env(map[string]string{
		"PIXELSORT_ADDR": ":9000", "PIXELSORT_DATA": "/d", "PIXELSORT_BUDGET_GB": "1.5", "PIXELSORT_MAX_UPLOAD_MB": "5",
		"PIXELSORT_TRASH_DAYS": "30", "PIXELSORT_LOG": "json", "PIXELSORT_DEPLOYMENT": "docker",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":9000" || c.DataDir != "/d" || c.BudgetGB != 1.5 || c.MaxUploadMB != 5 || c.TrashDays != 30 || c.LogFormat != "json" || c.Deployment != "docker" {
		t.Fatalf("overrides: %+v", c)
	}
}

func TestLoadConfigBadValuesNameTheVariable(t *testing.T) {
	for name, val := range map[string]string{
		"PIXELSORT_BUDGET_GB": "-1", "PIXELSORT_BUDGET_GB ": "x", "PIXELSORT_MAX_UPLOAD_MB": "0", "PIXELSORT_TRASH_DAYS": "0",
		"PIXELSORT_LOG": "xml", "PIXELSORT_DEPLOYMENT": "cloud",
	} {
		name = strings.TrimSpace(name)
		_, err := LoadConfig(env(map[string]string{name: val}))
		if err == nil || !strings.Contains(err.Error(), name) {
			t.Errorf("%s=%q: error %v should name the variable", name, val, err)
		}
	}
	if _, err := LoadConfig(env(map[string]string{"PIXELSORT_TRASH_DAYS": "abc"})); err == nil {
		t.Error("non-numeric trash days accepted")
	}
}
