package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/AutumnsGrove/pixelsort-go/server/blob"
	"github.com/AutumnsGrove/pixelsort-go/server/db"
)

// The final container image has no shell, wget or sqlite3, so the binary itself does the small operational jobs the
// backup script and Docker's HEALTHCHECK need.

func newSnapshot() *cobra.Command {
	var dataDir, out string
	c := &cobra.Command{
		Use:   "snapshot",
		Short: "Write a consistent copy of the database (safe while the server is running)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			n, err := snapshot(cmd.Context(), dataDir, out)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "snapshot %s: %d bytes, integrity ok\n", out, n)
			return err
		},
	}
	c.Flags().StringVar(&dataDir, "data", "./data", "data directory")
	c.Flags().StringVar(&out, "out", "", "file to write (must not exist, or be a regular file)")
	_ = c.MarkFlagRequired("out")
	return c
}

func snapshot(ctx context.Context, dataDir, out string) (int64, error) {
	if info, err := os.Lstat(out); err == nil {
		if !info.Mode().IsRegular() {
			return 0, fmt.Errorf("snapshot: %s exists and is not a regular file", out)
		}
		if err := os.Remove(out); err != nil { // VACUUM INTO refuses to overwrite
			return 0, fmt.Errorf("snapshot: replace %s: %w", out, err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return 0, fmt.Errorf("snapshot: %w", err)
	}
	d, err := db.Open(filepath.Join(dataDir, "pixelsort.db"))
	if err != nil {
		return 0, fmt.Errorf("snapshot: %w", err)
	}
	defer d.Close() //nolint:errcheck // read-mostly handle
	if err := db.Snapshot(ctx, d, out); err != nil {
		return 0, fmt.Errorf("snapshot: %w", err)
	}
	copyDB, err := db.Open(out)
	if err != nil {
		return 0, fmt.Errorf("snapshot: the copy does not open: %w", err)
	}
	defer copyDB.Close() //nolint:errcheck // read-only check
	var result string
	if err := copyDB.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); err != nil {
		return 0, fmt.Errorf("snapshot: integrity check: %w", err)
	}
	if result != "ok" {
		return 0, fmt.Errorf("snapshot: integrity check says %q", result)
	}
	info, err := os.Stat(out)
	if err != nil {
		return 0, fmt.Errorf("snapshot: %w", err)
	}
	return info.Size(), nil
}

func newHealthcheck() *cobra.Command {
	var addr string
	c := &cobra.Command{
		Use:   "healthcheck",
		Short: "Ask a running server whether it is healthy (Docker's HEALTHCHECK)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if err := healthcheck(cmd.Context(), addr); err != nil {
				return err
			}
			_, err := fmt.Fprintln(cmd.OutOrStdout(), "ok")
			return err
		},
	}
	c.Flags().StringVar(&addr, "addr", "127.0.0.1:8895", "address of the server")
	return c
}

func healthcheck(ctx context.Context, addr string) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+addr+"/healthz", nil)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	defer res.Body.Close() //nolint:errcheck // read-only body
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	if res.StatusCode != http.StatusOK || !strings.Contains(string(body), `"status":"ok"`) {
		return fmt.Errorf("healthcheck: status %d", res.StatusCode)
	}
	return nil
}

func newStarredList() *cobra.Command {
	var dataDir string
	c := &cobra.Command{
		Use:   "starred-list",
		Short: "List the result images of starred runs, one relative path per line (for the backup script)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			paths, err := starredList(cmd.Context(), dataDir)
			if err != nil {
				return err
			}
			for _, p := range paths {
				if _, err := fmt.Fprintln(cmd.OutOrStdout(), p); err != nil {
					return err
				}
			}
			return nil
		},
	}
	c.Flags().StringVar(&dataDir, "data", "./data", "data directory")
	return c
}

func starredList(ctx context.Context, dataDir string) ([]string, error) {
	d, err := db.Open(filepath.Join(dataDir, "pixelsort.db"))
	if err != nil {
		return nil, fmt.Errorf("starred-list: %w", err)
	}
	defer d.Close() //nolint:errcheck // read-only handle
	store, err := blob.New(dataDir, 1)
	if err != nil {
		return nil, fmt.Errorf("starred-list: %w", err)
	}
	rows, err := d.QueryContext(ctx, `SELECT i.sha256 FROM runs r JOIN images i ON i.id = r.result_id
		WHERE r.starred = 1 AND r.trashed_at IS NULL ORDER BY r.id`)
	if err != nil {
		return nil, fmt.Errorf("starred-list: %w", err)
	}
	defer rows.Close() //nolint:errcheck // read-only rows
	return collectPaths(rows, store)
}

func collectPaths(rows *sql.Rows, store *blob.Store) ([]string, error) {
	var out []string
	for rows.Next() {
		var sha string
		if err := rows.Scan(&sha); err != nil {
			return nil, fmt.Errorf("starred-list: %w", err)
		}
		if rel, ok := store.RelPath(sha); ok {
			out = append(out, rel)
		}
	}
	return out, rows.Err() //nolint:wrapcheck // rows.Err is already specific
}
