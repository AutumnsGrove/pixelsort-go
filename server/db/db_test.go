package db_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/AutumnsGrove/pixelsort-go/server/db"
)

func open(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

func count(t *testing.T, d *sql.DB, q string) int {
	t.Helper()
	var n int
	if err := d.QueryRow(q).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestFreshDatabaseMigrates(t *testing.T) {
	d := open(t)
	if err := db.Migrate(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"images", "runs", "tags", "presets", "shapes", "kv", "schema_migrations"} {
		if count(t, d, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='"+table+"'") != 1 {
			t.Errorf("table %s missing", table)
		}
	}
	var mode string
	if err := d.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil || mode != "wal" {
		t.Errorf("journal mode %q, err %v", mode, err)
	}
}

func TestMigrateTwiceIsANoop(t *testing.T) {
	d := open(t)
	for i := 0; i < 2; i++ {
		if err := db.Migrate(context.Background(), d); err != nil {
			t.Fatal(err)
		}
	}
	if n := count(t, d, "SELECT count(*) FROM schema_migrations"); n != 1 {
		t.Fatalf("%d migrations recorded", n)
	}
}

func TestFailingMigrationRollsBackCompletely(t *testing.T) {
	d := open(t)
	fsys := fstest.MapFS{"m/0001_bad.sql": {Data: []byte("CREATE TABLE a (x); CREATE TABLE a (y);")}}
	if err := db.MigrateFS(context.Background(), d, fsys, "m"); err == nil {
		t.Fatal("a broken migration succeeded")
	}
	if count(t, d, "SELECT count(*) FROM sqlite_master WHERE name='a'") != 0 {
		t.Fatal("half of the migration was kept")
	}
	if count(t, d, "SELECT count(*) FROM schema_migrations") != 0 {
		t.Fatal("a failed migration was recorded")
	}
}

func TestChangedMigrationIsDetected(t *testing.T) {
	d := open(t)
	v1 := fstest.MapFS{"m/0001_a.sql": {Data: []byte("CREATE TABLE a (x);")}}
	if err := db.MigrateFS(context.Background(), d, v1, "m"); err != nil {
		t.Fatal(err)
	}
	v2 := fstest.MapFS{"m/0001_a.sql": {Data: []byte("CREATE TABLE a (x, y);")}}
	err := db.MigrateFS(context.Background(), d, v2, "m")
	if err == nil || !strings.Contains(err.Error(), "0001_a.sql") {
		t.Fatalf("got %v, want an error naming the file", err)
	}
}

func TestForeignKeysAreEnforced(t *testing.T) {
	d := open(t)
	if err := db.Migrate(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	_, err := d.Exec(`INSERT INTO runs(created_at, original_id, result_id, thumb_id, settings_json, seed, engine_version)
		VALUES (1, 99, 99, 99, '{}', 1, '1')`)
	if err == nil {
		t.Fatal("a run with missing images was accepted")
	}
}

func TestSnapshotCopiesTheRows(t *testing.T) {
	d := open(t)
	ctx := context.Background()
	if err := db.Migrate(ctx, d); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO kv(key, value_json, updated_at) VALUES ('a', '1', 1)`); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(t.TempDir(), "snap.db")
	if err := db.Snapshot(ctx, d, dest); err != nil {
		t.Fatal(err)
	}
	s, err := db.Open(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close() //nolint:errcheck // test cleanup
	if count(t, s, "SELECT count(*) FROM kv") != 1 {
		t.Fatal("snapshot lost the rows")
	}
}
