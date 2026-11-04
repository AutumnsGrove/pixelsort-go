# Gallery API

Everything the server offers, read from the handlers in `server/api`. All bodies are JSON unless noted; times are unix
seconds; ids are integers. Every response carries `X-Request-Id`. Errors look like this (decision S3):

```json
{ "error": { "code": "not_found", "message": "not found" } }
```

Codes: `bad_request` (400), `not_found` (404), `conflict` (409), `too_large` (413), `bad_type` (400), `hash_mismatch`
(400), `starred_needs_confirm` (409, also carries `ids`), `rate_limited`, `internal` (500). The server never touches pixels:
the browser decodes and encodes images and uploads the results.

A **run** looks like:

```json
{ "id": 12, "created_at": 1700000000,
  "original": {"sha256": "…", "mime": "image/png", "w": 4032, "h": 2520, "bytes": 123},
  "result":   {…}, "thumb": {…},
  "settings": {"mode": "random", "angle": 45}, "seed": 7, "engine_version": "1", "duration_ms": 123,
  "parent_run_id": null, "source_url": null, "starred": false, "title": null, "notes": null, "trashed_at": null, "tags": [] }
```

## Health

### `GET /healthz`
`{"status":"ok","version":"r123.abc1234"}`. No database access; answers in milliseconds.
`curl localhost:8895/healthz`

### `GET /api/version`
`{"version":"…","deployment":"docker|dev","engine_version":"1"}`.

## Runs

### `POST /api/runs`
Create a run. `multipart/form-data`: a `meta` field (JSON) first, then the files `original` (omit it when the server
already has that image: ask `POST /api/images/check`), `result` and `thumb`. `meta`:
`{"settings":{…},"seed":7,"engine_version":"1","duration_ms":123,"parent_run_id":null,"source_url":null,"title":null,
"original":{"sha256":"…","mime":"image/png","w":1,"h":1},"result":{…},"thumb":{…}}`. Hashes are lowercase SHA-256 hex and
are verified against the bytes. Returns `201` with the run, or `200` with the existing run when the same original, settings,
seed and engine version were already saved (auto-save is idempotent). Errors: `400 bad_request` (bad meta, unknown original,
bad parent), `400 hash_mismatch`, `400 bad_type` (only PNG, JPEG, WebP and GIF are accepted), `413 too_large`.
`curl -F 'meta={…}' -F original=@a.png -F result=@b.png -F thumb=@t.png localhost:8895/api/runs`

### `GET /api/runs`
List with keyset pagination. Query: `cursor`, `limit` (default 60, max 200), `q` (searches the name and the recipe words:
mode, key, `45°`, `rule 110`), `starred=1`, `trashed=0|1|any` (default `0`), `sort=new|old|size`. Returns
`{"runs":[…],"next_cursor":"…"|null}`. A malformed cursor or filter is `400 bad_request`.
`curl 'localhost:8895/api/runs?limit=20&q=wave'`

### `GET /api/runs/{id}`
One run, or `404 not_found`.

### `PATCH /api/runs/{id}`
Any of `{"starred":bool,"title":string,"notes":string,"tags":[string]}`. The title is tidied like the web naming module
(control characters out, spaces collapsed, 60 code points; empty clears to the automatic name). Tags are replaced as a set
(at most 20, 40 characters each). Unknown fields are rejected. Returns the run.

### `POST /api/runs/trash`
`{"ids":[1,2],"confirm_starred":false}`. If any is starred and `confirm_starred` is not true, nothing is trashed and the
answer is `409 starred_needs_confirm` with the starred `ids`. Otherwise `{"trashed":[…],"missing":[…]}`.

### `POST /api/runs/restore`
`{"ids":[1,2]}` takes runs out of the trash. Returns `{"restored":2}`.

### `POST /api/trash/empty`
Permanently deletes every trashed run, re-parents their children, and removes images nothing references anymore.
Returns `{"deleted":3}`. (Runs trashed longer than `PIXELSORT_TRASH_DAYS` are removed automatically every ten minutes.)

## Images

### `POST /api/images/check`
`{"sha256":"…"}` returns `{"exists":true|false}`, so a client uploads the original only once.

### `GET /api/images/{sha256}`
The image bytes with `Content-Type`, `ETag`, `Cache-Control: immutable`, range support. A bad or unknown hash is `404`.
`curl -O localhost:8895/api/images/<sha>`

## Usage

### `GET /api/usage`
`{"used_bytes":…,"budget_bytes":…,"trash_bytes":…,"runs":…,"trash_runs":…}`. Each stored image counts once;
`trash_bytes` is what emptying the trash would free.

## Presets

### `GET /api/presets`
`{"presets":[{"id","name","description","settings","built_in","created_at"}]}`, built-ins first.

### `POST /api/presets`
`{"name":"…","description":"…","settings":{…}}`. Names are unique ignoring case (`409 conflict`). `settings` must be an
object whose keys are recipe fields (`400` otherwise). Returns `201` with the preset.

### `DELETE /api/presets/{id}`
`204`. Built-in presets answer `409 conflict`.

## Settings

### `GET /api/settings`
The settings object (`{}` if none saved).

### `PUT /api/settings`
Replaces it. Known keys only: `workRes` (null, 960, 1280, 1920, 2560), `exportFormat` (png, jpeg, webp), `exportQuality`
(40 to 100), `speed` (1 to 400), `stripMeta`, `embedRecipe`, `grain` (booleans), `shareExpiry` (never, 30), `motion`
(system, reduce). Anything else is `400`.

## Shapes

### `GET /api/shapes`
`{"shapes":[{"id","name","poly","more","created_at"}]}`, newest first.

### `POST /api/shapes`
`{"name":"…","poly":[[x,y],…],"more":[[[x,y],…]]}` in unit-square coordinates: at least 3 points, at most 2000 in total,
all finite. Returns `201`.

### `DELETE /api/shapes/{id}`
`204`, or `404`.
