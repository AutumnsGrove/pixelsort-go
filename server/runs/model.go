// Package runs is the gallery's data layer and its rules: creating runs from uploaded images, listing and
// updating them, the trash and its janitor, usage accounting, and the small user data (presets, settings, shapes).
// SQL lives here and in db; handlers in api only decode, call, and encode.
package runs

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Errors the API maps to status codes.
var (
	ErrNotFound      = errors.New("runs: not found")
	ErrInvalid       = errors.New("runs: invalid input")
	ErrConflict      = errors.New("runs: conflict")
	ErrStarredNeedOK = errors.New("runs: starred runs need confirmation")
)

// ImageInfo is one stored image as the API reports it.
type ImageInfo struct {
	SHA256 string `json:"sha256"`
	Mime   string `json:"mime"`
	W      int    `json:"w"`
	H      int    `json:"h"`
	Bytes  int64  `json:"bytes"`
}

// Run is one saved sort.
type Run struct {
	ID            int64           `json:"id"`
	CreatedAt     int64           `json:"created_at"`
	Original      ImageInfo       `json:"original"`
	Result        ImageInfo       `json:"result"`
	Thumb         ImageInfo       `json:"thumb"`
	Settings      json.RawMessage `json:"settings"`
	Seed          int64           `json:"seed"`
	EngineVersion string          `json:"engine_version"`
	DurationMS    int64           `json:"duration_ms"`
	ParentRunID   *int64          `json:"parent_run_id"`
	SourceURL     *string         `json:"source_url"`
	Starred       bool            `json:"starred"`
	Title         *string         `json:"title"`
	Notes         *string         `json:"notes"`
	TrashedAt     *int64          `json:"trashed_at"`
	Tags          []string        `json:"tags"`
}

var nameStrip = regexp.MustCompile(`[\x00-\x1f\x{7f}-\x{9f}\x{a0}\x{200b}-\x{200f}\x{202a}-\x{202e}\x{2066}-\x{2069}\x{feff}]`)
var spaces = regexp.MustCompile(`\s+`)

// MaxNameRunes is the longest a name or title may be, in code points.
const MaxNameRunes = 60

// CleanName makes typed text safe to keep: control and invisible characters become spaces, spaces collapse, the
// ends are trimmed and it is cut to 60 code points (never half an emoji). It matches web naming.clean.
func CleanName(s string) string {
	s = strings.TrimSpace(spaces.ReplaceAllString(nameStrip.ReplaceAllString(s, " "), " "))
	if utf8.RuneCountInString(s) > MaxNameRunes {
		r := []rune(s)
		s = strings.TrimSpace(string(r[:MaxNameRunes]))
	}
	return s
}
