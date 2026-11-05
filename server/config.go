package server

import (
	"fmt"
	"strconv"
)

// Config is everything the server reads from its environment.
type Config struct {
	Addr        string  // PIXELSORT_ADDR
	DataDir     string  // PIXELSORT_DATA
	BudgetGB    float64 // PIXELSORT_BUDGET_GB
	MaxUploadMB int     // PIXELSORT_MAX_UPLOAD_MB
	TrashDays   int     // PIXELSORT_TRASH_DAYS
	LogFormat   string  // PIXELSORT_LOG: "text" or "json"
	Deployment  string  // PIXELSORT_DEPLOYMENT: "docker" or "dev"
	UpdateDir   string  // PIXELSORT_UPDATE_DIR: the signal folder shared with the host watcher; empty = updates off
}

// BudgetBytes is the storage budget in bytes.
func (c Config) BudgetBytes() int64 { return int64(c.BudgetGB * (1 << 30)) }

// MaxUploadBytes is the largest request body the API accepts.
func (c Config) MaxUploadBytes() int64 { return int64(c.MaxUploadMB) << 20 }

// LoadConfig reads the configuration through getenv (os.Getenv in production, a map in tests). Every error names
// the variable at fault.
func LoadConfig(getenv func(string) string) (Config, error) {
	c := Config{Addr: "127.0.0.1:8895", DataDir: "./data", BudgetGB: 50, MaxUploadMB: 200, TrashDays: 7, LogFormat: "text", Deployment: "dev"}
	if v := getenv("PIXELSORT_ADDR"); v != "" {
		c.Addr = v
	}
	if v := getenv("PIXELSORT_DATA"); v != "" {
		c.DataDir = v
	}
	c.UpdateDir = getenv("PIXELSORT_UPDATE_DIR")
	if v := getenv("PIXELSORT_BUDGET_GB"); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || f <= 0 || f != f || f > 1e6 {
			return Config{}, fmt.Errorf("PIXELSORT_BUDGET_GB=%q: want a number above 0", v)
		}
		c.BudgetGB = f
	}
	if v := getenv("PIXELSORT_MAX_UPLOAD_MB"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 4096 {
			return Config{}, fmt.Errorf("PIXELSORT_MAX_UPLOAD_MB=%q: want a whole number from 1 to 4096", v)
		}
		c.MaxUploadMB = n
	}
	if v := getenv("PIXELSORT_TRASH_DAYS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 3650 {
			return Config{}, fmt.Errorf("PIXELSORT_TRASH_DAYS=%q: want a whole number from 1 to 3650", v)
		}
		c.TrashDays = n
	}
	if v := getenv("PIXELSORT_LOG"); v != "" {
		if v != "text" && v != "json" {
			return Config{}, fmt.Errorf("PIXELSORT_LOG=%q: want text or json", v)
		}
		c.LogFormat = v
	}
	if v := getenv("PIXELSORT_DEPLOYMENT"); v != "" {
		if v != "docker" && v != "dev" {
			return Config{}, fmt.Errorf("PIXELSORT_DEPLOYMENT=%q: want docker or dev", v)
		}
		c.Deployment = v
	}
	return c, nil
}
