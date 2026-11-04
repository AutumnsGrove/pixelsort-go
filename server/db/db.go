// Package db opens the gallery's SQLite database and applies its migrations.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strings"

	_ "modernc.org/sqlite" // the pure-Go SQLite driver, registered as "sqlite"
)

// Open opens (creating if needed) the database at path with WAL, a busy timeout, foreign keys and normal
// synchronous mode. One connection serves everything: this server's load is one person, and a single connection makes
// every write serialisable without further thought (decision S1).
func Open(path string) (*sql.DB, error) {
	q := url.Values{}
	for _, p := range []string{"journal_mode(WAL)", "busy_timeout(5000)", "foreign_keys(1)", "synchronous(NORMAL)"} {
		q.Add("_pragma", p)
	}
	dsn := "file:" + escapePath(path) + "?" + q.Encode()
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open %s: %w", path, err)
	}
	d.SetMaxOpenConns(1)
	if err := d.Ping(); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("db: open %s: %w", path, err)
	}
	return d, nil
}

// escapePath makes a filesystem path safe inside a file: URI.
func escapePath(p string) string {
	return strings.NewReplacer("%", "%25", "?", "%3f", "#", "%23").Replace(p)
}

// Snapshot writes a consistent copy of the database to dest with VACUUM INTO. dest must not exist.
func Snapshot(ctx context.Context, d *sql.DB, dest string) error {
	if _, err := d.ExecContext(ctx, "VACUUM INTO ?", dest); err != nil {
		return fmt.Errorf("db: snapshot to %s: %w", dest, err)
	}
	return nil
}
