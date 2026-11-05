package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/AutumnsGrove/pixelsort-go/server"
)

func newServe() *cobra.Command {
	var dir, addr string
	c := &cobra.Command{
		Use:   "serve",
		Short: "Serve the app and the gallery API",
		Long: "Serve the app and the gallery. Configuration is read from PIXELSORT_ADDR, PIXELSORT_DATA, " +
			"PIXELSORT_BUDGET_GB, PIXELSORT_MAX_UPLOAD_MB, PIXELSORT_TRASH_DAYS and PIXELSORT_LOG.",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if dir != "" { // the phase 0 spike: plain static files, no gallery
				return serveStatic(cmd, dir, addr)
			}
			cfg, err := server.LoadConfig(os.Getenv)
			if err != nil {
				return fmt.Errorf("serve: %w", err)
			}
			if addr != "" {
				cfg.Addr = addr
			}
			setupLogging(cfg.LogFormat)
			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			app, err := server.New(ctx, cfg, server.Options{})
			if err != nil {
				return fmt.Errorf("serve: %w", err)
			}
			slog.Info("serving", "addr", cfg.Addr, "data", cfg.DataDir)
			return app.Run(ctx)
		},
	}
	c.Flags().StringVar(&dir, "dir", "", "serve only the files in this directory (the phase 0 spike); empty serves the app")
	c.Flags().StringVar(&addr, "addr", "", "listen address (overrides PIXELSORT_ADDR)")
	_ = c.Flags().MarkHidden("dir")
	return c
}

func serveStatic(cmd *cobra.Command, dir, addr string) error {
	if addr == "" {
		addr = "127.0.0.1:8895"
	}
	if _, err := fmt.Fprintf(cmd.OutOrStdout(), "serving %s on http://%s\n", dir, addr); err != nil {
		return err
	}
	srv := &http.Server{Addr: addr, Handler: server.NewStaticHandler(dir), ReadHeaderTimeout: 10 * time.Second}
	return srv.ListenAndServe()
}

func setupLogging(format string) {
	var h slog.Handler = slog.NewTextHandler(os.Stderr, nil)
	if format == "json" {
		h = slog.NewJSONHandler(os.Stderr, nil)
	}
	slog.SetDefault(slog.New(h))
}
