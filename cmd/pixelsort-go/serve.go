package main

import (
	"fmt"
	"net/http"
	"time"

	"github.com/spf13/cobra"

	"github.com/AutumnsGrove/pixelsort-go/server"
)

func newServe() *cobra.Command {
	var dir, addr string
	c := &cobra.Command{
		Use:   "serve",
		Short: "Serve static files with cross-origin isolation (phase 0 spike; grows into the app server)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if _, err := fmt.Fprintf(cmd.OutOrStdout(), "serving %s on http://%s\n", dir, addr); err != nil {
				return err
			}
			srv := &http.Server{Addr: addr, Handler: server.NewStaticHandler(dir), ReadHeaderTimeout: 10 * time.Second}
			return srv.ListenAndServe()
		},
	}
	c.Flags().StringVar(&dir, "dir", "spike", "directory to serve")
	c.Flags().StringVar(&addr, "addr", "127.0.0.1:8895", "listen address")
	return c
}
