CREATE TABLE images (
  id         INTEGER PRIMARY KEY,
  sha256     TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  kind       TEXT NOT NULL CHECK (kind IN ('original','result','thumb','video')),
  mime       TEXT NOT NULL,
  width      INTEGER, height INTEGER,
  bytes      INTEGER NOT NULL CHECK (bytes >= 0),
  created_at INTEGER NOT NULL
);
CREATE TABLE runs (
  id            INTEGER PRIMARY KEY,
  created_at    INTEGER NOT NULL,
  original_id   INTEGER NOT NULL REFERENCES images(id),
  result_id     INTEGER NOT NULL REFERENCES images(id),
  thumb_id      INTEGER NOT NULL REFERENCES images(id),
  video_id      INTEGER REFERENCES images(id),
  settings_json TEXT NOT NULL,
  seed          INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  parent_run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
  source_url    TEXT,
  starred       INTEGER NOT NULL DEFAULT 0,
  title         TEXT,
  notes         TEXT,
  trashed_at    INTEGER
);
CREATE INDEX runs_by_time ON runs(created_at DESC, id DESC);
CREATE INDEX runs_trashed ON runs(trashed_at) WHERE trashed_at IS NOT NULL;
CREATE TABLE tags (run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (run_id, tag));
CREATE TABLE presets (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL, built_in INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE shapes (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, poly_json TEXT NOT NULL, more_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL);
CREATE TABLE kv (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
