package runs

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Preset is a named recipe.
type Preset struct {
	ID          int64           `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Settings    json.RawMessage `json:"settings"`
	BuiltIn     bool            `json:"built_in"`
	CreatedAt   int64           `json:"created_at"`
}

// Presets lists every preset, built-ins first.
func (s *Service) Presets(ctx context.Context) ([]Preset, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT id, name, description, settings_json, built_in, created_at FROM presets ORDER BY built_in DESC, name COLLATE NOCASE")
	if err != nil {
		return nil, fmt.Errorf("runs: presets: %w", err)
	}
	defer rows.Close() //nolint:errcheck // read-only rows
	out := []Preset{}
	for rows.Next() {
		var p Preset
		var settings string
		var builtIn int
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &settings, &builtIn, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("runs: scan preset: %w", err)
		}
		p.Settings, p.BuiltIn = json.RawMessage(settings), builtIn != 0
		out = append(out, p)
	}
	return out, rows.Err() //nolint:wrapcheck // rows.Err is already specific
}

// AddPreset saves a preset. Names are unique ignoring case.
func (s *Service) AddPreset(ctx context.Context, name, description string, settings json.RawMessage) (Preset, error) {
	name = CleanName(name)
	if name == "" {
		return Preset{}, invalid("a preset needs a name")
	}
	description = CleanName(description)
	now := s.Now().Unix()
	res, err := s.DB.ExecContext(ctx, "INSERT INTO presets(name, description, settings_json, built_in, created_at) VALUES (?,?,?,0,?)",
		name, description, string(settings), now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return Preset{}, fmt.Errorf("%w: a preset called %q already exists", ErrConflict, name)
		}
		return Preset{}, fmt.Errorf("runs: add preset: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Preset{}, fmt.Errorf("runs: add preset id: %w", err)
	}
	return Preset{ID: id, Name: name, Description: description, Settings: settings, CreatedAt: now}, nil
}

// DeletePreset removes a preset; built-ins cannot be deleted.
func (s *Service) DeletePreset(ctx context.Context, id int64) error {
	var builtIn int
	if err := s.DB.QueryRowContext(ctx, "SELECT built_in FROM presets WHERE id = ?", id).Scan(&builtIn); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("runs: preset lookup: %w", err)
	}
	if builtIn != 0 {
		return fmt.Errorf("%w: built-in presets cannot be deleted", ErrConflict)
	}
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM presets WHERE id = ?", id); err != nil {
		return fmt.Errorf("runs: delete preset: %w", err)
	}
	return nil
}

// Settings returns the stored settings object, or {} if none was saved.
func (s *Service) Settings(ctx context.Context) (json.RawMessage, error) {
	var v string
	err := s.DB.QueryRowContext(ctx, "SELECT value_json FROM kv WHERE key = 'settings'").Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return json.RawMessage(`{}`), nil
	}
	if err != nil {
		return nil, fmt.Errorf("runs: settings: %w", err)
	}
	return json.RawMessage(v), nil
}

// PutSettings replaces the settings object.
func (s *Service) PutSettings(ctx context.Context, v json.RawMessage) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO kv(key, value_json, updated_at) VALUES ('settings', ?, ?)
		ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, string(v), s.Now().Unix())
	if err != nil {
		return fmt.Errorf("runs: save settings: %w", err)
	}
	return nil
}

// Shape is a user-made tessellation shape: a polygon in unit-square coordinates plus optional extra rings.
type Shape struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	Poly      json.RawMessage `json:"poly"`
	More      json.RawMessage `json:"more"`
	CreatedAt int64           `json:"created_at"`
}

// Shapes lists the user's shapes, newest first.
func (s *Service) Shapes(ctx context.Context) ([]Shape, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT id, name, poly_json, more_json, created_at FROM shapes ORDER BY created_at DESC, id DESC")
	if err != nil {
		return nil, fmt.Errorf("runs: shapes: %w", err)
	}
	defer rows.Close() //nolint:errcheck // read-only rows
	out := []Shape{}
	for rows.Next() {
		var sh Shape
		var poly, more string
		if err := rows.Scan(&sh.ID, &sh.Name, &poly, &more, &sh.CreatedAt); err != nil {
			return nil, fmt.Errorf("runs: scan shape: %w", err)
		}
		sh.Poly, sh.More = json.RawMessage(poly), json.RawMessage(more)
		out = append(out, sh)
	}
	return out, rows.Err() //nolint:wrapcheck // rows.Err is already specific
}

// AddShape saves a shape; the caller has validated the geometry.
func (s *Service) AddShape(ctx context.Context, name string, poly, more json.RawMessage) (Shape, error) {
	name = CleanName(name)
	if name == "" {
		name = "Untitled shape"
	}
	if more == nil {
		more = json.RawMessage(`[]`)
	}
	now := s.Now().Unix()
	res, err := s.DB.ExecContext(ctx, "INSERT INTO shapes(name, poly_json, more_json, created_at) VALUES (?,?,?,?)", name, string(poly), string(more), now)
	if err != nil {
		return Shape{}, fmt.Errorf("runs: add shape: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Shape{}, fmt.Errorf("runs: add shape id: %w", err)
	}
	return Shape{ID: id, Name: name, Poly: poly, More: more, CreatedAt: now}, nil
}

// DeleteShape removes a shape.
func (s *Service) DeleteShape(ctx context.Context, id int64) error {
	res, err := s.DB.ExecContext(ctx, "DELETE FROM shapes WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("runs: delete shape: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
