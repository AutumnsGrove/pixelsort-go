package runs

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server/blob"
)

// Service owns the gallery rules.
type Service struct {
	DB        *sql.DB
	Blobs     *blob.Store
	Now       func() time.Time
	TrashDays int
}

// New returns a Service using the real clock.
func New(d *sql.DB, b *blob.Store, trashDays int) *Service {
	return &Service{DB: d, Blobs: b, Now: time.Now, TrashDays: trashDays}
}

// ImageMeta is what the client declares about one image part.
type ImageMeta struct {
	SHA256 string `json:"sha256"`
	Mime   string `json:"mime"`
	W      int    `json:"w"`
	H      int    `json:"h"`
}

// Meta is the JSON half of a create request.
type Meta struct {
	Settings      json.RawMessage `json:"settings"`
	Seed          int64           `json:"seed"`
	EngineVersion string          `json:"engine_version"`
	DurationMS    int64           `json:"duration_ms"`
	ParentRunID   *int64          `json:"parent_run_id"`
	SourceURL     *string         `json:"source_url"`
	Title         *string         `json:"title"`
	Original      ImageMeta       `json:"original"`
	Result        ImageMeta       `json:"result"`
	Thumb         ImageMeta       `json:"thumb"`
	// Video is optional: the exported animation to attach to this run.
	Video *ImageMeta `json:"video"`
}

// Parts are the uploaded files. Original may be nil when the server already has that image; Video may be nil unless
// the metadata declares one.
type Parts struct{ Original, Result, Thumb, Video io.Reader }

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrInvalid}, a...)...)
}

// Create stores a run. created is false when an identical run already existed and was returned instead, so
// auto-save is idempotent. Blobs written for a request that then fails are removed.
func (s *Service) Create(ctx context.Context, m Meta, p Parts) (run Run, created bool, err error) {
	if err := validateMeta(&m); err != nil {
		return Run{}, false, err
	}
	var fresh []string // blobs this request created, to remove if it fails
	defer func() {
		if err != nil {
			for _, sha := range fresh {
				_ = s.deleteIfUnreferenced(ctx, sha)
			}
		}
	}()
	put := func(r io.Reader, im ImageMeta) (blob.Blob, error) {
		existed := s.Blobs.Exists(im.SHA256)
		b, err := s.Blobs.Put(ctx, r, im.SHA256)
		if err != nil {
			return b, err
		}
		if !existed {
			fresh = append(fresh, b.SHA)
		}
		return b, nil
	}

	blobs := map[string]blob.Blob{}
	if p.Original != nil {
		b, err := put(p.Original, m.Original)
		if err != nil {
			return Run{}, false, err
		}
		blobs[m.Original.SHA256] = b
	} else {
		known, err := s.imageKnown(ctx, m.Original.SHA256)
		if err != nil {
			return Run{}, false, err
		}
		if !known {
			return Run{}, false, invalid("the original is not on the server and was not uploaded")
		}
	}
	if p.Result == nil || p.Thumb == nil {
		return Run{}, false, invalid("result and thumb files are required")
	}
	for _, x := range []struct {
		r  io.Reader
		im ImageMeta
	}{{p.Result, m.Result}, {p.Thumb, m.Thumb}} {
		b, err := put(x.r, x.im)
		if err != nil {
			return Run{}, false, err
		}
		blobs[x.im.SHA256] = b
	}
	if m.Video != nil {
		if p.Video == nil {
			return Run{}, false, invalid("the video is declared in meta but was not uploaded")
		}
		b, err := put(p.Video, *m.Video)
		if err != nil {
			return Run{}, false, err
		}
		blobs[m.Video.SHA256] = b
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Run{}, false, fmt.Errorf("runs: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	now := s.Now().Unix()
	if id, found, err := findDuplicate(ctx, tx, m); err != nil {
		return Run{}, false, err
	} else if found {
		if m.Video != nil {
			// The look is already stored; attach an animation only if it has none. A second export of the same look keeps
			// the first animation rather than replacing it.
			var videoID sql.NullInt64
			if err := tx.QueryRowContext(ctx, "SELECT video_id FROM runs WHERE id = ?", id).Scan(&videoID); err != nil {
				return Run{}, false, fmt.Errorf("runs: read existing video: %w", err)
			}
			if !videoID.Valid {
				vid, err := ensureImage(ctx, tx, "video", *m.Video, blobs, now)
				if err != nil {
					return Run{}, false, err
				}
				if _, err := tx.ExecContext(ctx, "UPDATE runs SET video_id = ? WHERE id = ?", vid, id); err != nil {
					return Run{}, false, fmt.Errorf("runs: attach video: %w", err)
				}
			}
		}
		if err := tx.Commit(); err != nil {
			return Run{}, false, fmt.Errorf("runs: commit: %w", err)
		}
		existing, gerr := s.Get(ctx, id)
		// Anything this request uploaded but did not end up referencing (a second animation, a redundant result) is
		// removed. deleteIfUnreferenced checks the rows, so the attached animation and already-known images stay.
		for _, sha := range fresh {
			_ = s.deleteIfUnreferenced(ctx, sha)
		}
		fresh = nil
		return existing, false, gerr
	}

	if m.ParentRunID != nil {
		var one int
		if err := tx.QueryRowContext(ctx, "SELECT 1 FROM runs WHERE id = ?", *m.ParentRunID).Scan(&one); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return Run{}, false, invalid("parent_run_id %d does not exist", *m.ParentRunID)
			}
			return Run{}, false, fmt.Errorf("runs: check parent: %w", err)
		}
	}
	ids := map[string]int64{}
	for _, x := range []struct {
		kind string
		im   ImageMeta
	}{{"original", m.Original}, {"result", m.Result}, {"thumb", m.Thumb}} {
		id, err := ensureImage(ctx, tx, x.kind, x.im, blobs, now)
		if err != nil {
			return Run{}, false, err
		}
		ids[x.kind] = id
	}
	var videoID any
	if m.Video != nil {
		id, err := ensureImage(ctx, tx, "video", *m.Video, blobs, now)
		if err != nil {
			return Run{}, false, err
		}
		videoID = id
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO runs(created_at, original_id, result_id, thumb_id, video_id, settings_json, seed,
		engine_version, duration_ms, parent_run_id, source_url, title) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		now, ids["original"], ids["result"], ids["thumb"], videoID, string(m.Settings), m.Seed, m.EngineVersion, m.DurationMS,
		m.ParentRunID, m.SourceURL, m.Title)
	if err != nil {
		return Run{}, false, fmt.Errorf("runs: insert: %w", err)
	}
	runID, err := res.LastInsertId()
	if err != nil {
		return Run{}, false, fmt.Errorf("runs: insert id: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Run{}, false, fmt.Errorf("runs: commit: %w", err)
	}
	run, err = s.Get(ctx, runID)
	return run, err == nil, err
}

func validateMeta(m *Meta) error {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(m.Settings, &obj); err != nil || obj == nil {
		return invalid("settings must be a JSON object")
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, m.Settings); err != nil {
		return invalid("settings: %v", err)
	}
	m.Settings = compact.Bytes()
	if strings.TrimSpace(m.EngineVersion) == "" || len(m.EngineVersion) > 40 {
		return invalid("engine_version is required")
	}
	if m.Seed < 0 || m.Seed > 0xffffffff {
		return invalid("seed must fit in 32 bits")
	}
	if m.DurationMS < 0 {
		return invalid("duration_ms must not be negative")
	}
	metas := map[string]ImageMeta{"original": m.Original, "result": m.Result, "thumb": m.Thumb}
	if m.Video != nil {
		metas["video"] = *m.Video
	}
	for name, im := range metas {
		if !blob.ValidSHA(im.SHA256) {
			return invalid("%s.sha256 is not a 64-character lowercase hex hash", name)
		}
		if im.W < 0 || im.H < 0 || im.W > 1<<16 || im.H > 1<<16 {
			return invalid("%s has an impossible size", name)
		}
	}
	if m.SourceURL != nil && (len(*m.SourceURL) > 2048 || (!strings.HasPrefix(*m.SourceURL, "https://") && !strings.HasPrefix(*m.SourceURL, "http://"))) {
		return invalid("source_url must be an http(s) URL")
	}
	if m.Title != nil {
		t := CleanName(*m.Title)
		if t == "" {
			m.Title = nil
		} else {
			m.Title = &t
		}
	}
	return nil
}

func (s *Service) imageKnown(ctx context.Context, sha string) (bool, error) {
	var one int
	err := s.DB.QueryRowContext(ctx, "SELECT 1 FROM images WHERE sha256 = ?", sha).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("runs: image lookup: %w", err)
	}
	return true, nil
}

// ImageExists backs POST /api/images/check.
func (s *Service) ImageExists(ctx context.Context, sha string) (bool, error) {
	if !blob.ValidSHA(sha) {
		return false, invalid("bad sha256")
	}
	return s.imageKnown(ctx, sha)
}

func findDuplicate(ctx context.Context, tx *sql.Tx, m Meta) (int64, bool, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT r.id FROM runs r JOIN images i ON i.id = r.original_id
		WHERE i.sha256 = ? AND r.settings_json = ? AND r.seed = ? AND r.engine_version = ? ORDER BY r.id LIMIT 1`,
		m.Original.SHA256, string(m.Settings), m.Seed, m.EngineVersion).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("runs: duplicate check: %w", err)
	}
	return id, true, nil
}

func ensureImage(ctx context.Context, tx *sql.Tx, kind string, im ImageMeta, blobs map[string]blob.Blob, now int64) (int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, "SELECT id FROM images WHERE sha256 = ?", im.SHA256).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("runs: image lookup: %w", err)
	}
	b, ok := blobs[im.SHA256]
	if !ok {
		return 0, invalid("image %s was not uploaded", im.SHA256)
	}
	res, err := tx.ExecContext(ctx, "INSERT INTO images(sha256, kind, mime, width, height, bytes, created_at) VALUES (?,?,?,?,?,?,?)",
		im.SHA256, kind, b.Mime, im.W, im.H, b.Size, now)
	if err != nil {
		return 0, fmt.Errorf("runs: insert image: %w", err)
	}
	id, err = res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("runs: insert image id: %w", err)
	}
	return id, nil
}

// deleteIfUnreferenced removes a blob no images row points to.
func (s *Service) deleteIfUnreferenced(ctx context.Context, sha string) error {
	known, err := s.imageKnown(ctx, sha)
	if err != nil || known {
		return err
	}
	return s.Blobs.Delete(sha)
}
