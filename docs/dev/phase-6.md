# Phase 6: the gallery server

**Goal.** A small Go server that serves the app and keeps the gallery: every run (original, result, thumbnail,
recipe) in SQLite plus files on disk, with usage accounting, trash with a 7-day undo, presets, user settings and
shapes, and a health endpoint. The server **never touches pixels**: browsers encode and decode.

**Spec sources.** `PLAN.md` sections 6 and 7; `decisions.md` S1 to S4, W4; the Archive and Studio strip behaviour in
`mockups/gallery.html`, `mockups/shared/runs-data.js`, `mockups/shared/states.js`.

**Depends on.** Phase 0 (module, `server` package, `serve` command). Independent of the engine: can be built before
or after phases 1 to 5.

**Exit criteria.**
1. `go test ./server/... -race` green; integration test drives the whole API over HTTP.
2. Fuzz targets run 30 s each without failure.
3. The app's `ServerBackend` passes the same storage tests as `LocalStorageBackend`, and a Playwright flow saves a
   run, reloads, finds it in the Archive, trashes and restores it.
4. `docs/api.md` documents every endpoint.

Branch: `build/phase-6`.

---

## Layout

```
server/
  app.go  config.go  headers.go  static.go            (headers.go/static.go exist from phase 0)
  httpx/        JSON helpers, error catalog, middleware (request id, recover, log, limits)
  db/           Open, migrations/*.sql (embedded), Migrate
  blob/         content-addressed file store
  runs/         repository (SQL) + service rules (trash, parenting, usage)
  api/          HTTP handlers; one file per resource
  spa/          go:embed of web/build with SPA fallback
```

Rules: handlers are thin (decode, call the service, encode); rules live in `runs/`; SQL lives only in `db/` and
`runs/`; every function that does I/O takes a `context.Context` first.

## Data model (migration `0001_init.sql`)

```sql
CREATE TABLE images (
  id         INTEGER PRIMARY KEY,
  sha256     TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  kind       TEXT NOT NULL CHECK (kind IN ('original','result','thumb','video')),
  mime       TEXT NOT NULL,
  width      INTEGER, height INTEGER,
  bytes      INTEGER NOT NULL CHECK (bytes >= 0),
  created_at INTEGER NOT NULL            -- unix seconds
);
CREATE TABLE runs (
  id            INTEGER PRIMARY KEY,
  created_at    INTEGER NOT NULL,
  original_id   INTEGER NOT NULL REFERENCES images(id),
  result_id     INTEGER NOT NULL REFERENCES images(id),
  thumb_id      INTEGER NOT NULL REFERENCES images(id),
  video_id      INTEGER REFERENCES images(id),
  settings_json TEXT NOT NULL,           -- the recipe, exactly as the engine reads it
  seed          INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  parent_run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
  source_url    TEXT,
  starred       INTEGER NOT NULL DEFAULT 0,
  title         TEXT,                    -- the name (naming module); NULL = automatic
  notes         TEXT,
  trashed_at    INTEGER                  -- unix seconds; NULL = not in the trash
);
CREATE INDEX runs_by_time ON runs(created_at DESC, id DESC);
CREATE INDEX runs_trashed ON runs(trashed_at) WHERE trashed_at IS NOT NULL;
CREATE TABLE tags (run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (run_id, tag));
CREATE TABLE presets (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL, built_in INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE shapes (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, poly_json TEXT NOT NULL, more_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL);
CREATE TABLE kv (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);   -- settings and small user state
```

The `shares` and `share_items` tables arrive in phase 6b (`0002_shares.sql`). Migrations are forward-only.

---

### P6-T01 · Config

**Files.** `server/config.go`, `server/config_test.go`.

**Spec.** `Config` loaded from environment: `PIXELSORT_ADDR` (default `127.0.0.1:8895`), `PIXELSORT_DATA` (default
`./data`), `PIXELSORT_BUDGET_GB` (default 50, float > 0), `PIXELSORT_MAX_UPLOAD_MB` (default 200), `PIXELSORT_TRASH_DAYS`
(default 7), `PIXELSORT_LOG` (`text`|`json`, default `text`). `LoadConfig(getenv func(string) string) (Config, error)`
so tests pass a map. Errors name the variable.

**Tests first.** Defaults; each variable overridden; each bad value (negative budget, non-numeric, unknown log
format, trash days 0) returns an error naming the variable; `Config.BudgetBytes()`.

**Commit.** `Add server config`

---

### P6-T02 · Database and migrations

**Files.** `server/db/db.go`, `server/db/migrate.go`, `server/db/migrations/0001_init.sql`, `server/db/db_test.go`.
Dependency: `go get modernc.org/sqlite@latest && go mod tidy`.

**Spec.**
- `Open(path string) (*sql.DB, error)`: driver `sqlite`, DSN pragmas: `journal_mode(WAL)`, `busy_timeout(5000)`,
  `foreign_keys(1)`, `synchronous(NORMAL)`. One writer: `SetMaxOpenConns(1)` for the write handle (simple and safe
  for this load); reads share it.
- `Migrate(ctx, db)`: reads `migrations/*.sql` (embedded, sorted by name), creates `schema_migrations(name TEXT PRIMARY KEY,
  checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)`, applies each unapplied file in **its own transaction**,
  records its SHA-256, and **refuses to start** if an applied file's checksum changed (error names the file).
- `Snapshot(ctx, db, dest string) error` using `VACUUM INTO` (used by phase 8's updater).

**Tests first.** Fresh database migrates and has every table; running `Migrate` twice is a no-op; a migration that
fails halfway rolls back completely (use a test migration set with a bad statement); a modified applied file is
detected; foreign keys are enforced (inserting a run with a missing image fails); `Snapshot` produces a file that
opens and contains the same rows; WAL mode is on.

**Commit.** `Add SQLite and migrations`

---

### P6-T03 · Blob store

**Files.** `server/blob/blob.go`, `blob_test.go`, `blob_fuzz_test.go`.

**Spec.** Content-addressed files under `<data>/images/ab/abcdef....<ext>` (first two hex characters as a directory).

```go
type Store struct{ root string; maxBytes int64 }
func New(root string, maxBytes int64) (*Store, error)
func (s *Store) Put(ctx context.Context, r io.Reader, declaredSHA string) (Blob, error) // Blob{SHA, Size, Mime, Ext}
func (s *Store) Open(sha string) (*os.File, Blob, error)
func (s *Store) Exists(sha string) bool
func (s *Store) Delete(sha string) error
```

- `Put` streams into a temp file in the same directory tree while hashing and counting; aborts with `ErrTooLarge`
  past `maxBytes`; if `declaredSHA` is non-empty and differs from the computed hash, `ErrHashMismatch` (and no file is
  left); detects the type from the first 512 bytes with `http.DetectContentType` and **allows only** `image/png`,
  `image/jpeg`, `image/webp`, `image/gif` (`ErrBadType` otherwise); renames atomically into place; if the content
  already exists, discards the temp file and returns the existing blob (deduplication).
- `sha` arguments are validated as exactly 64 lowercase hex characters before **any** path is built
  (`ErrBadSHA`); no path is ever built from other input, so traversal is impossible by construction.
- Files are created `0600`, directories `0700`.

**Tests first.** Put/Open round trip; dedupe (second `Put` of the same bytes writes nothing new); hash mismatch leaves
no file; oversize aborts and leaves no temp file; non-image bytes rejected; truncated PNG header still classified
by its first bytes; `sha` validation table (`""`, 63 chars, uppercase, `../..`, a null byte, 64 non-hex chars);
concurrent `Put` of the same content (10 goroutines, `-race`) leaves exactly one file. `FuzzBlobPut([]byte)`: any
bytes either store or are rejected, never panic, never leave a temp file. `FuzzSHA(string)`: validation never
accepts a string containing a path separator or anything outside `[0-9a-f]`.

**Commit.** `Add content-addressed blob store`

---

### P6-T04 · HTTP foundations

**Files.** `server/httpx/*.go`, tests.

**Spec.**
- Error envelope (decision S3): `{"error":{"code":"...","message":"..."}}`; `httpx.Error(w, status, code, msg)`.
  Code catalog constants: `bad_request`, `not_found`, `conflict`, `too_large`, `bad_type`, `hash_mismatch`,
  `starred_needs_confirm`, `rate_limited`, `internal`.
- Middleware (as plain `func(http.Handler) http.Handler`): request id (`X-Request-Id`, generated, echoed), panic
  recovery (500 with `internal`, stack logged with `log/slog`, never in the response), access log (method, path,
  status, duration, bytes; never query strings that contain tokens), body size limit
  (`http.MaxBytesReader`; 413 `too_large`), per-request timeout for non-streaming routes.
- JSON helpers: `Decode(r, &v)` rejects unknown fields and trailing data, limits size; `Write(w, status, v)`.

**Tests first.** Each middleware with `httptest`: panic becomes a 500 JSON envelope without leaking the panic text;
request id is set and echoed; oversize body gives 413; `Decode` rejects `{"a":1} {"b":2}` and unknown fields.

**Commit.** `Add HTTP foundations`

---

### P6-T05 · Create a run

**Files.** `server/runs/runs.go`, `server/runs/service.go`, `server/api/runs_create.go`, tests.

**Spec.** `POST /api/runs` is `multipart/form-data` with:
- `meta` (JSON): `{ "settings": {...}, "seed": 7, "engine_version": "1", "duration_ms": 123, "parent_run_id": null,
  "source_url": null, "title": null, "original": {"sha256": "...", "mime": "image/png", "w": 4032, "h": 2520},
  "result": {...same...}, "thumb": {...same...} }`
- file parts named `original`, `result`, `thumb`. The `original` part may be **omitted** when the server already
  has that sha (the client learns this from `POST /api/images/check` first); `result` and `thumb` are required.

The service, in one database transaction: stores each uploaded blob (verifying the hash declared in `meta`),
inserts missing `images` rows, validates that `settings` is a JSON object, `engine_version` is non-empty and
`parent_run_id` (if any) exists, inserts the `runs` row, and returns `201` with the run JSON (see below). If anything
fails, no run row exists and any newly stored blob that nothing references is deleted. A **duplicate** upload (same
original sha, same `settings` JSON, same seed, same engine version) returns the existing run with `200` instead of
creating a second one (auto-save must be idempotent).

`POST /api/images/check`: `{"sha256":"..."}` returns `{"exists":true|false}`.

Run JSON: `{id, created_at, original:{sha256,mime,w,h,bytes}, result:{...}, thumb:{...}, settings, seed,
engine_version, duration_ms, parent_run_id, source_url, starred, title, notes, trashed_at, tags:[...]}`.

**Tests first.** Happy path; omit `original` when known; unknown original without a part is `400`; hash mismatch is
`400 hash_mismatch` and leaves no run and no orphan files; bad `parent_run_id` is `400`; duplicate returns `200` and
the same id; oversize body `413`; non-image `result` is `400 bad_type`; `FuzzImageUpload`: random multipart bodies
and random `meta` text never panic and never leave a partial run.

**Commit.** `Add run creation`

---

### P6-T06 · Read, list, update

**Files.** `server/api/runs_read.go`, `runs_update.go`, `server/runs/query.go`, tests.

**Spec.**
- `GET /api/runs/{id}`: one run; `404` if missing.
- `GET /api/runs?cursor=&limit=&q=&starred=1&trashed=0|1|any&sort=new|old|size`: **keyset pagination** on
  `(created_at, id)`; `limit` default 60, max 200; the cursor is an opaque base64 of the last `(created_at, id)`
  (or size) and is validated strictly (a bad cursor is `400 bad_request`, never a panic or an SQL error);
  `q` searches `title` and the recipe words (`mode`, `key`, angle as `45°`, `rule N`) case-insensitively with
  parameterised `LIKE` (escape `%`, `_`, `\`); default `trashed=0`. Response `{runs:[...], next_cursor:"..."|null}`.
- `PATCH /api/runs/{id}`: any of `{starred, title, notes, tags}`; `title` is cleaned with the same rules as the web
  naming module (strip control characters, collapse spaces, 60 code points; empty clears to automatic); `tags` replaced
  as a set (max 20, each <= 40 chars). Unknown fields are rejected.

**Tests first.** Pagination returns every run exactly once across pages with 250 runs; stable under inserts between
pages; `limit` clamps; each filter; `q` with `%` and `_` matches literally; a bad cursor is `400`; PATCH title rules
(control characters, 61 code points, an emoji at the boundary not split, empty); `FuzzRunsQuery(query string)`: random
query strings never panic or return `500`.

**Commit.** `Add run list, get and update`

---

### P6-T07 · Trash, restore, empty

**Files.** `server/runs/trash.go`, `server/api/trash.go`, `server/runs/janitor.go`, tests.

**Spec.** (PLAN.md section 6 "Behavior", decision D5.)
- `POST /api/runs/trash` `{ids:[...], confirm_starred:false}`: sets `trashed_at = now` for those runs. If any id is a
  starred run and `confirm_starred` is not true, **nothing is trashed** and the response is
  `409 starred_needs_confirm` listing those ids. A missing id is ignored (reported in `missing`).
- `POST /api/runs/restore` `{ids}`: clears `trashed_at`.
- `POST /api/trash/empty`: permanently deletes every trashed run now. Deleting a run **re-parents its children** to
  its parent (or none): `UPDATE runs SET parent_run_id = <deleted.parent_run_id> WHERE parent_run_id = <deleted.id>`;
  then deletes the rows, then **garbage-collects** images no run references and deletes their files. Order matters:
  database first (one transaction), files after; a crash in between leaves orphan files that the janitor sweeps.
- `Janitor`: `Run(ctx, now func() time.Time)` empties runs trashed longer than `TrashDays`, and sweeps files in the
  blob store that no `images` row references (orphans) older than 1 hour. A `time.Ticker` goroutine in `app.go`
  calls it every 10 minutes and stops with the context. The clock is injected; tests never sleep.

**Tests first.** Trash then restore; starred needs confirm and trashes nothing on refusal; confirm trashes; empty
re-parents children (build a 3-level chain, delete the middle) and GC leaves shared images (two runs sharing one
original keep it until both are gone); janitor deletes only runs older than the window (fake clock); orphan sweep
removes an unreferenced file but not a fresh one or a referenced one; everything under `-race` with concurrent
trash and list.

**Commit.** `Add trash, restore and janitor`

---

### P6-T08 · Usage

**Files.** `server/runs/usage.go`, `server/api/usage.go`, tests.

**Spec.** `GET /api/usage` returns `{used_bytes, budget_bytes, trash_bytes, runs, trash_runs}`.
`used_bytes` = sum of `bytes` over images referenced by any run, **each image counted once** (shared originals
count once); `trash_bytes` = the part of that referenced *only* by trashed runs (what emptying the trash would
free). `budget_bytes` from config. Never an error for an empty database (zeros).

**Tests first.** Empty is zeros; two runs sharing an original count it once; trashing a run moves its exclusive
bytes to `trash_bytes` but not a shared original still used by a live run; emptying the trash reduces `used_bytes`
by exactly `trash_bytes`.

**Commit.** `Add usage endpoint`

---

### P6-T09 · Presets, settings, shapes

**Files.** `server/api/presets.go`, `settings.go`, `shapes.go`, `server/runs/userdata.go`, tests.

**Spec.**
- `GET/POST /api/presets`, `DELETE /api/presets/{id}`: names unique case-insensitively (`409 conflict`), built-ins
  (`built_in=1`) cannot be deleted (`403`-like `conflict`), `settings_json` must parse as `engine`-shaped params
  (**the server does not import the engine**: validate that it is a JSON object with no unknown top-level key from a
  fixed allow-list in `server/api/recipe.go` that a test keeps in sync with `engine.Params` by reflecting the engine's
  JSON tags: the test may import `engine`; production code may not).
- `GET/PUT /api/settings`: the whole settings object as JSON in `kv` under `settings` (validated like
  `web/src/lib/settings.ts`: known keys only, bounded numbers). `PUT` replaces; a bad body is `400`.
- `GET/POST /api/shapes`, `DELETE /api/shapes/{id}`: polygon JSON in unit-square coordinates; reject more than
  2000 points or non-finite numbers; names cleaned like run titles.

**Tests first.** CRUD for each; duplicate preset name differing only in case conflicts; deleting a built-in is
refused; a settings body with an unknown key or `exportQuality: 500` is rejected; a shape with `NaN` (sent as a
string) or 2001 points is rejected; the allow-list test fails if `engine.Params` gains a field that the server
list lacks.

**Commit.** `Add presets, settings and shapes`

---

### P6-T10 · Serving images

**Files.** `server/api/images.go`, tests.

**Spec.** `GET /api/images/{sha256}` serves the blob with `http.ServeContent` (ranges work), `Content-Type` from the
stored mime, `ETag: "<sha>"`, `Cache-Control: public, max-age=31536000, immutable`, and
`X-Content-Type-Options: nosniff`, `Content-Disposition: inline`. A bad sha is `404` (not `400`; do not reveal the
rule). Never serve a type other than the four allowed image types.

**Tests first.** Round trip bytes; `Range: bytes=0-9` returns `206`; `If-None-Match` returns `304`; bad sha `404`;
headers present.

**Commit.** `Serve images`

---

### P6-T11 · Health, version, SPA, security headers

**Files.** `server/api/health.go`, `server/spa/spa.go`, `server/headers.go` (extend), `internal/version` (use), tests.

**Spec.**
- `GET /healthz` returns `{"status":"ok","version":"<Version>"}` and nothing else, answering in milliseconds, no
  database access (decision S4). `GET /api/version` returns version, deployment (`docker` or `dev`) and engine
  version.
- `spa.Handler(fsys fs.FS)`: serves the embedded `web/build` with `index.html` fallback for unknown **non-API,
  non-asset** paths; assets under `/_app/` get `Cache-Control: public, max-age=31536000, immutable`; `index.html`
  gets `no-cache`; `engine.wasm` is served `application/wasm`. `//go:embed all:build` lives in
  `server/spa/embed.go` behind a build tag `embedweb` so `go test` works without a built web app; a normal build uses
  an empty FS stub that returns a clear message.
- Security headers on every response: the three `Cross-Origin-*` headers from phase 0, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer`, and a `Content-Security-Policy`:
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data:;
  style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'none';
  frame-ancestors 'none'`. (`connect-src https:` is needed for the browser's direct image fetch by URL; note that in a
  comment. `'unsafe-inline'` for styles is needed for Svelte's scoped styles; drop it if the build allows.)

**Tests first.** `/healthz` shape and speed (under 50 ms), no DB touch (nil DB works); SPA fallback serves
`index.html` for `/studio` but returns `404` for `/api/nope` and `/_app/missing.js`; cache headers; CSP header present
and parseable (assert key directives); `application/wasm`.

**Commit.** `Add health, SPA serving and security headers`

---

### P6-T12 · Wire it together: app and `serve`

**Files.** `server/app.go`, `cmd/pixelsort-go/serve.go` (extend), `server/app_test.go`, `server/integration_test.go`.

**Spec.** `server.New(cfg, deps) (*App, error)` builds db, blob store, services and the router
(Go 1.22+ `http.ServeMux` patterns: `GET /api/runs/{id}`). `App.Run(ctx)` serves until the context ends, then shuts
down gracefully (10 s). `serve` loads config, opens `PIXELSORT_DATA`, migrates, installs a `signal.NotifyContext`
for SIGINT and SIGTERM, and starts the janitor. The earlier `--dir` flag stays for the spike but is hidden unless
set.

**Integration test** (over `httptest.NewServer`, real SQLite in a temp dir): upload a run with three tiny PNGs;
list it; fetch each image; star it; rename it; trash it (starred requires confirm); restore; empty the trash;
usage returns to zero; `GET /healthz` works throughout; `-race`.

**Commit.** `Wire the server and serve command`

---

### P6-T13 · `docs/api.md`

Write `docs/api.md`: every endpoint with method, path, request, response, error codes and one `curl` example,
generated by reading the handlers (not from memory). Add a test (`server/api/docs_test.go`) that every route
registered in the router appears in `docs/api.md` (parse the file for `` `METHOD /path` ``) so the doc cannot rot.

**Commit.** `Document the API`

---

### P6-T14 · The web `ServerBackend` and auto-save

**Files.** `web/src/lib/storage/server.ts`, `server.test.ts`, `web/src/lib/autosave.ts`, `autosave.test.ts`,
`web/e2e/server.spec.ts`, `web/playwright.config.ts` (second project that starts the Go server).

**Spec.**
- `ServerBackend` implements the phase 5 storage interface over the API: `listRuns` (cursor paging), `getRun`,
  `saveRun` (checks `images/check`, uploads only what is missing, computes SHA-256 with `crypto.subtle`), `patchRun`,
  `trash`, `restore`, `emptyTrash`, `usage`, presets, settings, shapes. Errors map to the web error catalog.
- **Auto-save rule** (decided here): a run is saved when **(a)** an animation finishes, or **(b)** 2 seconds pass with
  no change after a completed live-preview sort, or **(c)** the user exports. Never on every slider tick.
  De-duplicate by `sha256(original) + recipe JSON + seed + engineVersion` (the server also de-duplicates). The thumbnail
  is made in the browser (320 px long edge, `canvas.toBlob` WebP at quality 0.8). The result is encoded losslessly
  (PNG; WebP lossless where supported). Failures never block: they show the non-blocking `save-failed` banner and
  retry later with backoff (30 s, 2 min, 10 min), keeping the blobs in memory only while the tab lives.
- Switching the app to the server backend is a single choice in one module; `LocalStorageBackend` stays for dev.

**Tests first.** `server.test.ts` with a fake `fetch`: `saveRun` skips the original upload when `exists` is true;
cursor paging concatenates pages; error responses map to catalog codes. `autosave.test.ts` with a fake clock and
backend: finishing an animation saves once; five rapid previews then silence save once after 2 s; identical recipe
twice saves once; a failing backend retries on the backoff schedule and never throws into the UI. Playwright (starts
the real Go binary on a temp data dir): sort a generated image, wait for the run to appear in the Archive, reload,
still there, rename it, trash it, restore it, usage meter updates.

**Commit.** `Add server storage backend and auto-save`

---

### P6-T15 · Phase wrap-up

`make check`, `make test`, `make fuzz FUZZTIME=30s`, `make e2e`. Tick `PROGRESS.md`. In `NOTES.md` record the on-disk
size of a 12 MP run (measure with a real photo) so the 50 GB estimate in PLAN.md can be checked.

**Commit.** `Finish phase 6`
