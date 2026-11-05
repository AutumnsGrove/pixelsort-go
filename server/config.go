package server

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
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
	// WorkerURL and WorkerSecret point at the Cloudflare share Worker. Both empty = sharing and URL loading are off.
	WorkerURL    string // PIXELSORT_WORKER_URL: https, no trailing slash (http is allowed for localhost, for wrangler dev)
	WorkerSecret string // PIXELSORT_WORKER_SECRET: signs every request; never leaves this process
}

// WorkerConfigured reports whether the share Worker can be used.
func (c Config) WorkerConfigured() bool { return c.WorkerURL != "" && c.WorkerSecret != "" }

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
	if err := loadWorker(getenv, &c); err != nil {
		return Config{}, err
	}
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

// loadWorker reads the Worker pair. Both or neither: one without the other is a mistake worth stopping for.
func loadWorker(getenv func(string) string, c *Config) error {
	raw, secret := strings.TrimSpace(getenv("PIXELSORT_WORKER_URL")), getenv("PIXELSORT_WORKER_SECRET")
	if raw == "" && secret == "" {
		return nil
	}
	if raw == "" || secret == "" {
		return errors.New("PIXELSORT_WORKER_URL and PIXELSORT_WORKER_SECRET must be set together")
	}
	u, err := url.Parse(strings.TrimRight(raw, "/"))
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return fmt.Errorf("PIXELSORT_WORKER_URL=%q: want a plain https address like https://pixelsort-share.example.workers.dev", raw)
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"
	if u.Scheme != "https" && (u.Scheme != "http" || !local) {
		return fmt.Errorf("PIXELSORT_WORKER_URL=%q: want https (http is only allowed for localhost)", raw)
	}
	c.WorkerURL = u.Scheme + "://" + u.Host
	c.WorkerSecret = secret
	return nil
}
