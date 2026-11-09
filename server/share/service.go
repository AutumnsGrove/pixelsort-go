package share

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server/blob"
	"github.com/AutumnsGrove/pixelsort-go/server/runs"
)

// Errors the API maps to status codes.
var (
	ErrNotFound         = errors.New("share: not found")
	ErrInvalid          = errors.New("share: invalid input")
	ErrOriginalsMissing = errors.New("share: originals are required")
)

// MaxImages is the Worker's limit on images in one album.
const MaxImages = 200

// MaxAnimationBytes is the size cap for a shared animation. The panel warns before it, and this refuses one over it.
const MaxAnimationBytes = 25 << 20

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// Service creates, lists and revokes shares.
type Service struct {
	DB     *sql.DB
	Blobs  *blob.Store
	Runs   *runs.Service
	Client *Client
	Now    func() time.Time
	NewID  func() string
}

// New wires a Service with the real clock and a random id source.
func New(d *sql.DB, blobs *blob.Store, r *runs.Service, c *Client) *Service {
	return &Service{DB: d, Blobs: blobs, Runs: r, Client: c, Now: time.Now, NewID: randomID}
}

// randomID is 128 random bits as 26 lower-case base32 characters, the shape the Worker accepts.
func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("share: no randomness: " + err.Error()) // the process cannot make safe ids; stop rather than guess
	}
	return strings.ToLower(b32.EncodeToString(b[:]))[:26]
}

// Original is a browser-re-encoded, metadata-stripped original. The server never sends a stored original as is.
type Original struct {
	Mime string
	Data []byte
}

// CreateRequest is the body of POST /api/shares.
type CreateRequest struct {
	RunIDs          []int64 `json:"run_ids"`
	IncludeRecipe   bool    `json:"include_recipe"`
	IncludeOriginal bool    `json:"include_original"`
	ExpiresInDays   *int    `json:"expires_in_days"`
	Title           string  `json:"title"`
}

// Created is what the caller gets back.
type Created struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	ExpiresAt *int64 `json:"expires_at"`
}

type manifestImage struct {
	W      int             `json:"w"`
	H      int             `json:"h"`
	Mime   string          `json:"mime"`
	Name   string          `json:"name,omitempty"`
	Recipe json.RawMessage `json:"recipe,omitempty"`
}

type manifest struct {
	V       int             `json:"v"`
	Created int64           `json:"created"`
	Expires *int64          `json:"expires"`
	Title   string          `json:"title,omitempty"`
	Images  []manifestImage `json:"images"`
}

// allowedMime is what an album may hold: stills, GIF/APNG animations, and the video formats the studio can write.
var allowedMime = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true, "image/apng": true,
	"video/mp4": true, "video/webm": true,
}

type upload struct {
	n      int
	thumb  bool
	path   string
	mime   string
	sha    string
	size   int64
	opener Opener
}

// Create uploads the album to the Worker (images first, the manifest last, so nobody sees half an album), then
// records it. If anything fails the partial album is revoked and no row is left.
func (s *Service) Create(ctx context.Context, req CreateRequest, originals map[int64]Original) (Created, error) {
	if len(req.RunIDs) == 0 {
		return Created{}, fmt.Errorf("%w: choose at least one run", ErrInvalid)
	}
	if req.ExpiresInDays != nil && (*req.ExpiresInDays < 1 || *req.ExpiresInDays > 3650) {
		return Created{}, fmt.Errorf("%w: expires_in_days must be from 1 to 3650", ErrInvalid)
	}
	if req.IncludeOriginal {
		for _, id := range req.RunIDs {
			if _, ok := originals[id]; !ok {
				return Created{}, fmt.Errorf("%w: send a metadata-stripped original for run %d", ErrOriginalsMissing, id)
			}
		}
	}
	id := s.NewID()
	now := s.Now()
	m := manifest{V: 1, Created: now.Unix(), Title: runs.CleanName(req.Title), Images: []manifestImage{}}
	if req.ExpiresInDays != nil {
		e := now.Add(time.Duration(*req.ExpiresInDays) * 24 * time.Hour).Unix()
		m.Expires = &e
	}
	var ups []upload
	add := func(img manifestImage, resultSHA, resultMime string, size int64, thumbSHA, thumbMime string, thumbSize int64, original *Original) {
		n := len(m.Images)
		m.Images = append(m.Images, img)
		base := "/api/albums/" + id
		if original != nil {
			data := original.Data
			ups = append(ups, upload{n: n, path: fmt.Sprintf("%s/images/%d", base, n), mime: original.Mime, sha: BodySHA(data), size: int64(len(data)),
				opener: func() (io.ReadCloser, error) { return io.NopCloser(strings.NewReader(string(data))), nil }})
		} else {
			ups = append(ups, upload{n: n, path: fmt.Sprintf("%s/images/%d", base, n), mime: resultMime, sha: resultSHA, size: size, opener: s.blobOpener(resultSHA)})
		}
		ups = append(ups, upload{n: n, thumb: true, path: fmt.Sprintf("%s/thumbs/%d", base, n), mime: thumbMime, sha: thumbSHA, size: thumbSize, opener: s.blobOpener(thumbSHA)})
	}
	for _, rid := range req.RunIDs {
		run, err := s.Runs.Get(ctx, rid)
		if err != nil {
			if errors.Is(err, runs.ErrNotFound) {
				return Created{}, fmt.Errorf("%w: run %d does not exist", ErrNotFound, rid)
			}
			return Created{}, fmt.Errorf("share: load run %d: %w", rid, err)
		}
		if run.TrashedAt != nil {
			return Created{}, fmt.Errorf("%w: run %d is in the trash", ErrInvalid, rid)
		}
		shown := run.Result
		if run.Video != nil {
			if run.Video.Bytes > MaxAnimationBytes {
				return Created{}, fmt.Errorf("%w: the animation for run %d is larger than 25 MB", ErrInvalid, rid)
			}
			shown = *run.Video
		}
		if !allowedMime[shown.Mime] || !allowedMime[run.Thumb.Mime] {
			return Created{}, fmt.Errorf("%w: run %d is not a PNG, JPEG, WebP, GIF, APNG, MP4 or WebM", ErrInvalid, rid)
		}
		name := ""
		if run.Title != nil {
			name = runs.CleanName(*run.Title)
		}
		w, h := run.Result.W, run.Result.H
		if run.Video != nil && run.Video.W > 0 && run.Video.H > 0 {
			w, h = run.Video.W, run.Video.H // the animation may be scaled down from the still
		}
		img := manifestImage{W: w, H: h, Mime: shown.Mime, Name: name}
		if req.IncludeRecipe {
			img.Recipe = run.Settings
		}
		add(img, shown.SHA256, shown.Mime, shown.Bytes, run.Thumb.SHA256, run.Thumb.Mime, run.Thumb.Bytes, nil)
		if req.IncludeOriginal {
			o := originals[rid]
			if !allowedMime[o.Mime] || len(o.Data) == 0 {
				return Created{}, fmt.Errorf("%w: the original for run %d must be a PNG, JPEG or WebP", ErrInvalid, rid)
			}
			oimg := manifestImage{W: run.Original.W, H: run.Original.H, Mime: o.Mime}
			if name != "" {
				oimg.Name = name + " (original)"
			}
			add(oimg, "", "", 0, run.Thumb.SHA256, run.Thumb.Mime, run.Thumb.Bytes, &o)
		}
	}
	if len(m.Images) > MaxImages {
		return Created{}, fmt.Errorf("%w: at most %d images in one share", ErrInvalid, MaxImages)
	}

	if err := s.send(ctx, id, ups, m); err != nil {
		s.revokeQuietly(id)
		return Created{}, err
	}
	if err := s.record(ctx, id, now, m.Expires, req, m.Title); err != nil {
		s.revokeQuietly(id)
		return Created{}, err
	}
	return Created{ID: id, URL: s.Client.base + "/a/" + id, ExpiresAt: m.Expires}, nil
}

func (s *Service) blobOpener(sha string) Opener {
	return func() (io.ReadCloser, error) {
		f, _, err := s.Blobs.Open(sha)
		if err != nil {
			return nil, fmt.Errorf("share: open blob: %w", err)
		}
		return f, nil
	}
}

func (s *Service) send(ctx context.Context, id string, ups []upload, m manifest) error {
	for _, u := range ups {
		if err := s.Client.Put(ctx, u.path, u.mime, u.sha, u.size, u.opener); err != nil {
			return err
		}
	}
	body, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("share: marshal manifest: %w", err)
	}
	return s.Client.PutBytes(ctx, "/api/albums/"+id+"/manifest.json", "application/json", body)
}

// revokeQuietly removes a partial album; the original error is what the caller reports.
func (s *Service) revokeQuietly(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := s.Client.DeleteAlbum(ctx, id); err != nil {
		slog.Warn("share: could not remove a partial album", "id", id, "err", err)
	}
}

func (s *Service) record(ctx context.Context, id string, now time.Time, expires *int64, req CreateRequest, title string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("share: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // a no-op after Commit
	var titleArg any
	if title != "" {
		titleArg = title
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO shares (share_id, created_at, expires_at, include_recipe, include_original, title)
		VALUES (?, ?, ?, ?, ?, ?)`, id, now.Unix(), expires, b2i(req.IncludeRecipe), b2i(req.IncludeOriginal), titleArg)
	if err != nil {
		return fmt.Errorf("share: insert: %w", err)
	}
	rowID, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("share: row id: %w", err)
	}
	for i, rid := range req.RunIDs {
		if _, err := tx.ExecContext(ctx, "INSERT INTO share_items (share_id, run_id, position) VALUES (?, ?, ?)", rowID, rid, i); err != nil {
			return fmt.Errorf("share: insert item: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("share: commit: %w", err)
	}
	return nil
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// Share is one row as the Albums tab shows it.
type Share struct {
	ID              string  `json:"id"`
	URL             string  `json:"url"`
	CreatedAt       int64   `json:"created_at"`
	ExpiresAt       *int64  `json:"expires_at"`
	RevokedAt       *int64  `json:"revoked_at"`
	Title           *string `json:"title"`
	IncludeRecipe   bool    `json:"include_recipe"`
	IncludeOriginal bool    `json:"include_original"`
	Items           int     `json:"items"`
	RunIDs          []int64 `json:"run_ids"`
}

// List returns every share, newest first.
func (s *Service) List(ctx context.Context) ([]Share, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT s.id, s.share_id, s.created_at, s.expires_at, s.revoked_at, s.title, s.include_recipe, s.include_original
		FROM shares s ORDER BY s.created_at DESC, s.id DESC`)
	if err != nil {
		return nil, fmt.Errorf("share: list: %w", err)
	}
	defer rows.Close() //nolint:errcheck // read-only rows
	out := []Share{}
	rowIDs := map[string]int64{}
	for rows.Next() {
		var sh Share
		var rowID int64
		var rec, orig int
		if err := rows.Scan(&rowID, &sh.ID, &sh.CreatedAt, &sh.ExpiresAt, &sh.RevokedAt, &sh.Title, &rec, &orig); err != nil {
			return nil, fmt.Errorf("share: scan: %w", err)
		}
		sh.IncludeRecipe, sh.IncludeOriginal = rec != 0, orig != 0
		sh.URL = s.Client.base + "/a/" + sh.ID
		sh.RunIDs = []int64{}
		rowIDs[sh.ID] = rowID
		out = append(out, sh)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("share: list rows: %w", err)
	}
	for i := range out {
		items, err := s.DB.QueryContext(ctx, "SELECT run_id FROM share_items WHERE share_id = ? ORDER BY position", rowIDs[out[i].ID])
		if err != nil {
			return nil, fmt.Errorf("share: items: %w", err)
		}
		for items.Next() {
			var rid int64
			if err := items.Scan(&rid); err != nil {
				_ = items.Close()
				return nil, fmt.Errorf("share: scan item: %w", err)
			}
			out[i].RunIDs = append(out[i].RunIDs, rid)
		}
		if err := items.Close(); err != nil {
			return nil, fmt.Errorf("share: close items: %w", err)
		}
		out[i].Items = len(out[i].RunIDs)
	}
	return out, nil
}

// Revoke asks the Worker to delete the album, then marks the row. If the Worker cannot be reached the row stays
// unrevoked so the call can be retried. Revoking twice is fine.
func (s *Service) Revoke(ctx context.Context, shareID string) error {
	var revoked sql.NullInt64
	err := s.DB.QueryRowContext(ctx, "SELECT revoked_at FROM shares WHERE share_id = ?", shareID).Scan(&revoked)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("share: look up: %w", err)
	}
	if revoked.Valid {
		return nil
	}
	if err := s.Client.DeleteAlbum(ctx, shareID); err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, "UPDATE shares SET revoked_at = ? WHERE share_id = ? AND revoked_at IS NULL", s.Now().Unix(), shareID); err != nil {
		return fmt.Errorf("share: mark revoked: %w", err)
	}
	return nil
}

// IsShared reports whether a live (not revoked, not expired) share contains the run.
func (s *Service) IsShared(ctx context.Context, runID int64) (bool, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM share_items i JOIN shares s ON s.id = i.share_id
		WHERE i.run_id = ? AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)`, runID, s.Now().Unix()).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("share: is shared: %w", err)
	}
	return n > 0, nil
}
