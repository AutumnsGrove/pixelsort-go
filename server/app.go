package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server/api"
	"github.com/AutumnsGrove/pixelsort-go/server/blob"
	"github.com/AutumnsGrove/pixelsort-go/server/db"
	"github.com/AutumnsGrove/pixelsort-go/server/runs"
	"github.com/AutumnsGrove/pixelsort-go/server/spa"
)

// engineVersion is reported by /api/version. The server never imports the engine (it never touches pixels), so
// the value is set by the build; the web app also knows it from the WASM.
const engineVersion = "1"

// App is the assembled server: database, blob store, services and the router.
type App struct {
	cfg  Config
	db   *sql.DB
	svc  *runs.Service
	api  *api.API
	http *http.Server
}

// Options are the parts of an App that tests replace.
type Options struct {
	WebFS fs.FS // the built web app; nil uses the embedded one
}

// New opens the data directory, migrates the database and builds the router.
func New(ctx context.Context, cfg Config, opts Options) (*App, error) {
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return nil, fmt.Errorf("server: data dir: %w", err)
	}
	d, err := db.Open(filepath.Join(cfg.DataDir, "pixelsort.db"))
	if err != nil {
		return nil, err //nolint:wrapcheck // db.Open already names the file
	}
	if err := db.Migrate(ctx, d); err != nil {
		_ = d.Close()
		return nil, err //nolint:wrapcheck // db.Migrate already names the migration
	}
	store, err := blob.New(cfg.DataDir, cfg.MaxUploadBytes())
	if err != nil {
		_ = d.Close()
		return nil, err //nolint:wrapcheck // blob.New already names the directory
	}
	svc := runs.New(d, store, cfg.TrashDays)
	a := api.New(api.Deps{Runs: svc, Blobs: store, BudgetBytes: cfg.BudgetBytes(), MaxUploadBytes: cfg.MaxUploadBytes(),
		Deployment: cfg.Deployment, EngineVersion: engineVersion})
	web := opts.WebFS
	if web == nil {
		web = spa.FS()
	}
	mux := http.NewServeMux()
	mux.Handle("/healthz", a.Handler())
	mux.Handle("/api/", a.Handler())
	mux.Handle("/", spa.Handler(web))
	app := &App{cfg: cfg, db: d, svc: svc, api: a}
	app.http = &http.Server{Addr: cfg.Addr, Handler: SecurityHeaders(ContentSecurityPolicy(spa.InlineScriptHashes(web)), mux), ReadHeaderTimeout: 10 * time.Second}
	return app, nil
}

// Handler is the whole site, for tests that use httptest.
func (a *App) Handler() http.Handler { return a.http.Handler }

// Runs exposes the service (tests, the update tooling in phase 8).
func (a *App) Runs() *runs.Service { return a.svc }

// DB exposes the database handle (snapshots in phase 8).
func (a *App) DB() *sql.DB { return a.db }

// Routes lists the API routes (docs test).
func (a *App) Routes() []string { return a.api.Routes() }

// Run serves until ctx ends, then shuts down gracefully (10 s) and closes the database. The janitor runs every ten
// minutes and stops with the context.
func (a *App) Run(ctx context.Context) error {
	janitorDone := make(chan struct{})
	go func() {
		defer close(janitorDone)
		a.svc.RunJanitor(ctx, 10*time.Minute, func(err error) { slog.Error("janitor", "err", err) })
	}()
	errc := make(chan error, 1)
	go func() { errc <- a.http.ListenAndServe() }()
	var err error
	select {
	case err = <-errc:
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		err = a.http.Shutdown(shutdown)
	}
	<-janitorDone
	if cerr := a.db.Close(); cerr != nil && err == nil {
		err = cerr
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Close releases the database (tests that never call Run).
func (a *App) Close() error { return a.db.Close() }
