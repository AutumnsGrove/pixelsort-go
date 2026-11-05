-- Share links. There is no revoke token: only this server holds the Worker's secret, so only it can revoke.
CREATE TABLE shares (
  id INTEGER PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  include_recipe INTEGER NOT NULL,
  include_original INTEGER NOT NULL,
  title TEXT,
  revoked_at INTEGER);
CREATE TABLE share_items (
  share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (share_id, position));
CREATE INDEX share_items_by_run ON share_items(run_id);
