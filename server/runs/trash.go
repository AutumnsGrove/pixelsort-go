package runs

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// TrashResult says what Trash did.
type TrashResult struct {
	Trashed []int64
	Missing []int64
	// Starred lists starred runs that blocked the request; when it is non-empty nothing was trashed.
	Starred []int64
}

func inClause(ids []int64) (string, []any) {
	marks := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		marks[i], args[i] = "?", id
	}
	return "(" + strings.Join(marks, ",") + ")", args
}

// Trash moves runs to the trash. If any is starred and confirmStarred is false, nothing is trashed (PLAN.md 6, D5).
func (s *Service) Trash(ctx context.Context, ids []int64, confirmStarred bool) (TrashResult, error) {
	var res TrashResult
	if len(ids) == 0 {
		return res, nil
	}
	if len(ids) > 5000 {
		return res, invalid("too many ids")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return res, fmt.Errorf("runs: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	set, args := inClause(ids)
	rows, err := tx.QueryContext(ctx, "SELECT id, starred FROM runs WHERE id IN "+set, args...)
	if err != nil {
		return res, fmt.Errorf("runs: trash lookup: %w", err)
	}
	found := map[int64]bool{}
	for rows.Next() {
		var id int64
		var starred int
		if err := rows.Scan(&id, &starred); err != nil {
			_ = rows.Close()
			return res, fmt.Errorf("runs: trash scan: %w", err)
		}
		found[id] = true
		if starred != 0 {
			res.Starred = append(res.Starred, id)
		}
	}
	if err := rows.Close(); err != nil {
		return res, fmt.Errorf("runs: trash lookup: %w", err)
	}
	for _, id := range ids {
		if !found[id] {
			res.Missing = append(res.Missing, id)
		}
	}
	if len(res.Starred) > 0 && !confirmStarred {
		return res, ErrStarredNeedOK
	}
	res.Starred = nil
	now := s.Now().Unix()
	for id := range found {
		if _, err := tx.ExecContext(ctx, "UPDATE runs SET trashed_at = ? WHERE id = ? AND trashed_at IS NULL", now, id); err != nil {
			return res, fmt.Errorf("runs: trash: %w", err)
		}
		res.Trashed = append(res.Trashed, id)
	}
	if err := tx.Commit(); err != nil {
		return res, fmt.Errorf("runs: commit: %w", err)
	}
	return res, nil
}

// Restore takes runs out of the trash.
func (s *Service) Restore(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	set, args := inClause(ids)
	if _, err := s.DB.ExecContext(ctx, "UPDATE runs SET trashed_at = NULL WHERE id IN "+set, args...); err != nil {
		return fmt.Errorf("runs: restore: %w", err)
	}
	return nil
}

// EmptyTrash permanently deletes every trashed run and returns how many.
func (s *Service) EmptyTrash(ctx context.Context) (int, error) {
	return s.deleteTrashed(ctx, nil)
}

// deleteTrashed deletes trashed runs (all, or those with trashed_at before cutoff), re-parents their children, and
// garbage-collects images nothing references. The database changes in one transaction; files are removed after it,
// so a crash in between leaves orphan files for the janitor, never a run whose image is gone.
func (s *Service) deleteTrashed(ctx context.Context, cutoff *int64) (int, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("runs: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	q := "SELECT id, parent_run_id FROM runs WHERE trashed_at IS NOT NULL"
	var args []any
	if cutoff != nil {
		q += " AND trashed_at < ?"
		args = append(args, *cutoff)
	}
	q += " ORDER BY id"
	rows, err := tx.QueryContext(ctx, q, args...)
	if err != nil {
		return 0, fmt.Errorf("runs: list trashed: %w", err)
	}
	type victim struct {
		id     int64
		parent sql.NullInt64
	}
	var victims []victim
	for rows.Next() {
		var v victim
		if err := rows.Scan(&v.id, &v.parent); err != nil {
			_ = rows.Close()
			return 0, fmt.Errorf("runs: scan trashed: %w", err)
		}
		victims = append(victims, v)
	}
	if err := rows.Close(); err != nil {
		return 0, fmt.Errorf("runs: list trashed: %w", err)
	}
	for _, v := range victims {
		// Re-read the parent: an earlier deletion in this batch may already have moved it.
		var parent sql.NullInt64
		if err := tx.QueryRowContext(ctx, "SELECT parent_run_id FROM runs WHERE id = ?", v.id).Scan(&parent); err != nil {
			return 0, fmt.Errorf("runs: read parent: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "UPDATE runs SET parent_run_id = ? WHERE parent_run_id = ?", parent, v.id); err != nil {
			return 0, fmt.Errorf("runs: re-parent: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM runs WHERE id = ?", v.id); err != nil {
			return 0, fmt.Errorf("runs: delete: %w", err)
		}
	}
	gone, err := collectUnreferenced(ctx, tx)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("runs: commit: %w", err)
	}
	for _, sha := range gone {
		if err := s.Blobs.Delete(sha); err != nil {
			return len(victims), fmt.Errorf("runs: remove file: %w", err)
		}
	}
	return len(victims), nil
}

// collectUnreferenced deletes image rows no run points to and returns their hashes.
func collectUnreferenced(ctx context.Context, tx *sql.Tx) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, sha256 FROM images WHERE id NOT IN
		(SELECT original_id FROM runs UNION SELECT result_id FROM runs UNION SELECT thumb_id FROM runs
		 UNION SELECT video_id FROM runs WHERE video_id IS NOT NULL)`)
	if err != nil {
		return nil, fmt.Errorf("runs: find unreferenced images: %w", err)
	}
	var ids []int64
	var shas []string
	for rows.Next() {
		var id int64
		var sha string
		if err := rows.Scan(&id, &sha); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("runs: scan image: %w", err)
		}
		ids, shas = append(ids, id), append(shas, sha)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("runs: find unreferenced images: %w", err)
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, "DELETE FROM images WHERE id = ?", id); err != nil {
			return nil, fmt.Errorf("runs: delete image row: %w", err)
		}
	}
	return shas, nil
}

// SweepOrphans removes files in the store that no images row references and that are older than minAge, which
// catches the leftovers of a crash between a transaction and its file deletions (and half-finished uploads).
func (s *Service) SweepOrphans(ctx context.Context, minAge time.Duration) (int, error) {
	cutoff := s.Now().Add(-minAge).Unix()
	var orphans []string
	err := s.Blobs.Walk(func(sha string, mod int64) error {
		if mod > cutoff {
			return nil
		}
		known, err := s.imageKnown(ctx, sha)
		if err != nil {
			return err
		}
		if !known {
			orphans = append(orphans, sha)
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("runs: sweep: %w", err)
	}
	for _, sha := range orphans {
		if err := s.Blobs.Delete(sha); err != nil {
			return 0, fmt.Errorf("runs: sweep delete: %w", err)
		}
	}
	return len(orphans), nil
}

// Janitor empties runs trashed for longer than the retention window and sweeps orphan files. The clock is the
// service's, so tests inject it.
func (s *Service) Janitor(ctx context.Context) error {
	cutoff := s.Now().Add(-time.Duration(s.TrashDays) * 24 * time.Hour).Unix()
	if _, err := s.deleteTrashed(ctx, &cutoff); err != nil {
		return err
	}
	_, err := s.SweepOrphans(ctx, time.Hour)
	return err
}

// RunJanitor calls Janitor every interval until ctx ends. It owns its ticker and stops with the context.
func (s *Service) RunJanitor(ctx context.Context, interval time.Duration, onErr func(error)) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := s.Janitor(ctx); err != nil && onErr != nil {
				onErr(err)
			}
		}
	}
}

// Usage is the storage accounting the UI's meter shows.
type Usage struct {
	UsedBytes   int64 `json:"used_bytes"`
	BudgetBytes int64 `json:"budget_bytes"`
	TrashBytes  int64 `json:"trash_bytes"`
	Runs        int64 `json:"runs"`
	TrashRuns   int64 `json:"trash_runs"`
}

// Usage counts every referenced image once; trash_bytes is what emptying the trash would free.
func (s *Service) Usage(ctx context.Context, budget int64) (Usage, error) {
	u := Usage{BudgetBytes: budget}
	const refs = `SELECT original_id AS id, trashed_at FROM runs UNION ALL SELECT result_id, trashed_at FROM runs
		UNION ALL SELECT thumb_id, trashed_at FROM runs UNION ALL SELECT video_id, trashed_at FROM runs WHERE video_id IS NOT NULL`
	if err := s.DB.QueryRowContext(ctx, "WITH refs AS ("+refs+") SELECT COALESCE(SUM(bytes),0) FROM images WHERE id IN (SELECT id FROM refs)").
		Scan(&u.UsedBytes); err != nil {
		return u, fmt.Errorf("runs: usage: %w", err)
	}
	if err := s.DB.QueryRowContext(ctx, `WITH refs AS (`+refs+`) SELECT COALESCE(SUM(bytes),0) FROM images WHERE id IN
		(SELECT id FROM refs) AND id NOT IN (SELECT id FROM refs WHERE trashed_at IS NULL)`).Scan(&u.TrashBytes); err != nil {
		return u, fmt.Errorf("runs: usage: %w", err)
	}
	if err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM runs WHERE trashed_at IS NULL").Scan(&u.Runs); err != nil {
		return u, fmt.Errorf("runs: usage: %w", err)
	}
	if err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM runs WHERE trashed_at IS NOT NULL").Scan(&u.TrashRuns); err != nil {
		return u, fmt.Errorf("runs: usage: %w", err)
	}
	return u, nil
}
