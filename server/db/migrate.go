package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"time"
)

//go:embed migrations/*.sql
var embedded embed.FS

// Migrate applies the embedded migrations that have not run yet, each in its own transaction, and refuses to go on
// if a migration that was already applied has changed since (migrations are forward-only).
func Migrate(ctx context.Context, d *sql.DB) error {
	return MigrateFS(ctx, d, embedded, "migrations")
}

// MigrateFS is Migrate over any directory of .sql files; tests use it to supply broken migrations.
func MigrateFS(ctx context.Context, d *sql.DB, fsys fs.FS, dir string) error {
	if _, err := d.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("db: migrations table: %w", err)
	}
	entries, err := fs.ReadDir(fsys, dir)
	if err != nil {
		return fmt.Errorf("db: read migrations: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		body, err := fs.ReadFile(fsys, dir+"/"+name)
		if err != nil {
			return fmt.Errorf("db: read migration %s: %w", name, err)
		}
		sum := sha256.Sum256(body)
		checksum := hex.EncodeToString(sum[:])
		var applied string
		err = d.QueryRowContext(ctx, "SELECT checksum FROM schema_migrations WHERE name = ?", name).Scan(&applied)
		switch {
		case err == nil:
			if applied != checksum {
				return fmt.Errorf("db: migration %s was changed after it was applied", name)
			}
			continue
		case !errors.Is(err, sql.ErrNoRows):
			return fmt.Errorf("db: check migration %s: %w", name, err)
		}
		if err := apply(ctx, d, name, string(body), checksum); err != nil {
			return err
		}
	}
	return nil
}

func apply(ctx context.Context, d *sql.DB, name, body, checksum string) error {
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("db: begin migration %s: %w", name, err)
	}
	defer func() { _ = tx.Rollback() }() // a no-op after Commit
	if _, err := tx.ExecContext(ctx, body); err != nil {
		return fmt.Errorf("db: migration %s: %w", name, err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(name, checksum, applied_at) VALUES (?, ?, ?)",
		name, checksum, time.Now().Unix()); err != nil {
		return fmt.Errorf("db: record migration %s: %w", name, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("db: commit migration %s: %w", name, err)
	}
	return nil
}
