package runs

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const runColumns = `r.id, r.created_at, r.settings_json, r.seed, r.engine_version, r.duration_ms, r.parent_run_id, r.source_url,
	r.starred, r.title, r.notes, r.trashed_at,
	o.sha256, o.mime, COALESCE(o.width,0), COALESCE(o.height,0), o.bytes,
	x.sha256, x.mime, COALESCE(x.width,0), COALESCE(x.height,0), x.bytes,
	t.sha256, t.mime, COALESCE(t.width,0), COALESCE(t.height,0), t.bytes`

const runJoins = `FROM runs r JOIN images o ON o.id = r.original_id JOIN images x ON x.id = r.result_id JOIN images t ON t.id = r.thumb_id`

type scanner interface{ Scan(...any) error }

func scanRun(s scanner) (Run, error) {
	var r Run
	var settings string
	var starred int
	err := s.Scan(&r.ID, &r.CreatedAt, &settings, &r.Seed, &r.EngineVersion, &r.DurationMS, &r.ParentRunID, &r.SourceURL,
		&starred, &r.Title, &r.Notes, &r.TrashedAt,
		&r.Original.SHA256, &r.Original.Mime, &r.Original.W, &r.Original.H, &r.Original.Bytes,
		&r.Result.SHA256, &r.Result.Mime, &r.Result.W, &r.Result.H, &r.Result.Bytes,
		&r.Thumb.SHA256, &r.Thumb.Mime, &r.Thumb.W, &r.Thumb.H, &r.Thumb.Bytes)
	if err != nil {
		return Run{}, err //nolint:wrapcheck // wrapped by the caller with context
	}
	r.Settings = json.RawMessage(settings)
	r.Starred = starred != 0
	r.Tags = []string{}
	return r, nil
}

// loadTags fills Tags for runs in one query.
func (s *Service) loadTags(ctx context.Context, runs []Run) error {
	if len(runs) == 0 {
		return nil
	}
	idx := make(map[int64]int, len(runs))
	args := make([]any, 0, len(runs))
	marks := make([]string, 0, len(runs))
	for i, r := range runs {
		idx[r.ID] = i
		args = append(args, r.ID)
		marks = append(marks, "?")
	}
	query := "SELECT run_id, tag FROM tags WHERE run_id IN (" + strings.Join(marks, ",") + ") ORDER BY tag" //nolint:gosec // G202: only "?" placeholders are concatenated; values are bound
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("runs: load tags: %w", err)
	}
	defer rows.Close() //nolint:errcheck // read-only rows
	for rows.Next() {
		var id int64
		var tag string
		if err := rows.Scan(&id, &tag); err != nil {
			return fmt.Errorf("runs: scan tag: %w", err)
		}
		runs[idx[id]].Tags = append(runs[idx[id]].Tags, tag)
	}
	return rows.Err() //nolint:wrapcheck // rows.Err is already specific
}

// Get returns one run, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id int64) (Run, error) {
	r, err := scanRun(s.DB.QueryRowContext(ctx, "SELECT "+runColumns+" "+runJoins+" WHERE r.id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return Run{}, ErrNotFound
	}
	if err != nil {
		return Run{}, fmt.Errorf("runs: get %d: %w", id, err)
	}
	out := []Run{r}
	if err := s.loadTags(ctx, out); err != nil {
		return Run{}, err
	}
	return out[0], nil
}

// ListQuery is a validated list request.
type ListQuery struct {
	Cursor  string
	Limit   int
	Q       string
	Starred bool
	Trashed string // "0", "1" or "any"
	Sort    string // "new", "old" or "size"
}

// Page is one page of runs.
type Page struct {
	Runs       []Run   `json:"runs"`
	NextCursor *string `json:"next_cursor"`
}

type cursor struct {
	V  int64 `json:"v"`
	ID int64 `json:"id"`
}

func encodeCursor(c cursor) string {
	b, _ := json.Marshal(c) // two integers always marshal
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(s string) (cursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return cursor{}, invalid("bad cursor")
	}
	var c cursor
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil || c.ID < 0 {
		return cursor{}, invalid("bad cursor")
	}
	return c, nil
}

// likeEscape escapes LIKE wildcards so a search for 50% matches the characters, not "anything".
func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// List returns a page using keyset pagination, so pages stay stable while runs are being added.
func (s *Service) List(ctx context.Context, q ListQuery) (Page, error) {
	if q.Limit <= 0 {
		q.Limit = 60
	}
	q.Limit = min(q.Limit, 200)
	if q.Trashed == "" {
		q.Trashed = "0"
	}
	if q.Sort == "" {
		q.Sort = "new"
	}
	var where []string
	var args []any
	switch q.Trashed {
	case "0":
		where = append(where, "r.trashed_at IS NULL")
	case "1":
		where = append(where, "r.trashed_at IS NOT NULL")
	case "any":
	default:
		return Page{}, invalid("trashed must be 0, 1 or any")
	}
	if q.Starred {
		where = append(where, "r.starred = 1")
	}
	for _, w := range strings.Fields(q.Q) {
		where = append(where, `lower(COALESCE(r.title,'') || ' ' || COALESCE(json_extract(r.settings_json,'$.mode'),'') || ' ' ||
			COALESCE(json_extract(r.settings_json,'$.key'),'') || ' ' || COALESCE(json_extract(r.settings_json,'$.angle'),'') || '°' || ' rule ' ||
			COALESCE(json_extract(r.settings_json,'$.rule'),'')) LIKE ? ESCAPE '\'`)
		args = append(args, "%"+likeEscape(strings.ToLower(w))+"%")
	}

	// The sort key and its direction. size sorts by the result's bytes, largest first.
	var keyExpr, dir string
	switch q.Sort {
	case "new":
		keyExpr, dir = "r.created_at", "DESC"
	case "old":
		keyExpr, dir = "r.created_at", "ASC"
	case "size":
		keyExpr, dir = "x.bytes", "DESC"
	default:
		return Page{}, invalid("sort must be new, old or size")
	}
	if q.Cursor != "" {
		c, err := decodeCursor(q.Cursor)
		if err != nil {
			return Page{}, err
		}
		cmp := "<"
		if dir == "ASC" {
			cmp = ">"
		}
		where = append(where, fmt.Sprintf("(%s %s ? OR (%s = ? AND r.id %s ?))", keyExpr, cmp, keyExpr, cmp))
		args = append(args, c.V, c.V, c.ID)
	}
	query := "SELECT " + runColumns + ", " + keyExpr + " " + runJoins //nolint:gosec // G202: every part is a constant or a fixed column expression chosen above, never user input
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += fmt.Sprintf(" ORDER BY %s %s, r.id %s LIMIT %d", keyExpr, dir, dir, q.Limit+1)

	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return Page{}, fmt.Errorf("runs: list: %w", err)
	}
	defer rows.Close() //nolint:errcheck // read-only rows
	var out []Run
	var keys []int64
	for rows.Next() {
		var key int64
		r, err := scanRunWithKey(rows, &key)
		if err != nil {
			return Page{}, fmt.Errorf("runs: scan: %w", err)
		}
		out = append(out, r)
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return Page{}, fmt.Errorf("runs: list: %w", err)
	}
	page := Page{Runs: []Run{}}
	if len(out) > q.Limit {
		out, keys = out[:q.Limit], keys[:q.Limit]
		next := encodeCursor(cursor{V: keys[q.Limit-1], ID: out[q.Limit-1].ID})
		page.NextCursor = &next
	}
	if err := s.loadTags(ctx, out); err != nil {
		return Page{}, err
	}
	page.Runs = append(page.Runs, out...)
	return page, nil
}

// scanRunWithKey scans the run columns followed by one extra integer (the sort key).
func scanRunWithKey(rows *sql.Rows, key *int64) (Run, error) {
	return scanRun(withExtra{rows, key})
}

type withExtra struct {
	s     scanner
	extra *int64
}

func (w withExtra) Scan(dest ...any) error { return w.s.Scan(append(dest, w.extra)...) }

// Patch is a partial update; absent fields are left alone.
type Patch struct {
	Starred *bool     `json:"starred"`
	Title   *string   `json:"title"`
	Notes   *string   `json:"notes"`
	Tags    *[]string `json:"tags"`
}

// Update applies a patch and returns the run.
func (s *Service) Update(ctx context.Context, id int64, p Patch) (Run, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Run{}, fmt.Errorf("runs: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var one int
	if err := tx.QueryRowContext(ctx, "SELECT 1 FROM runs WHERE id = ?", id).Scan(&one); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Run{}, ErrNotFound
		}
		return Run{}, fmt.Errorf("runs: update lookup: %w", err)
	}
	if p.Starred != nil {
		if _, err := tx.ExecContext(ctx, "UPDATE runs SET starred = ? WHERE id = ?", boolInt(*p.Starred), id); err != nil {
			return Run{}, fmt.Errorf("runs: star: %w", err)
		}
	}
	if p.Title != nil {
		var title any
		if t := CleanName(*p.Title); t != "" {
			title = t
		}
		if _, err := tx.ExecContext(ctx, "UPDATE runs SET title = ? WHERE id = ?", title, id); err != nil {
			return Run{}, fmt.Errorf("runs: title: %w", err)
		}
	}
	if p.Notes != nil {
		if len(*p.Notes) > 10000 {
			return Run{}, invalid("notes are limited to 10000 bytes")
		}
		var notes any
		if n := strings.TrimSpace(*p.Notes); n != "" {
			notes = n
		}
		if _, err := tx.ExecContext(ctx, "UPDATE runs SET notes = ? WHERE id = ?", notes, id); err != nil {
			return Run{}, fmt.Errorf("runs: notes: %w", err)
		}
	}
	if p.Tags != nil {
		tags, err := cleanTags(*p.Tags)
		if err != nil {
			return Run{}, err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM tags WHERE run_id = ?", id); err != nil {
			return Run{}, fmt.Errorf("runs: clear tags: %w", err)
		}
		for _, t := range tags {
			if _, err := tx.ExecContext(ctx, "INSERT INTO tags(run_id, tag) VALUES (?, ?)", id, t); err != nil {
				return Run{}, fmt.Errorf("runs: add tag: %w", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return Run{}, fmt.Errorf("runs: commit: %w", err)
	}
	return s.Get(ctx, id)
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// cleanTags cleans each tag, drops empties and duplicates, and enforces the limits (20 tags, 40 code points each).
func cleanTags(in []string) ([]string, error) {
	seen := map[string]bool{}
	var out []string
	for _, t := range in {
		c := CleanName(t)
		if c == "" || seen[strings.ToLower(c)] {
			continue
		}
		if len([]rune(c)) > 40 {
			return nil, invalid("a tag is limited to 40 characters")
		}
		seen[strings.ToLower(c)] = true
		out = append(out, c)
	}
	if len(out) > 20 {
		return nil, invalid("at most 20 tags")
	}
	return out, nil
}
