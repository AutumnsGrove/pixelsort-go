# Gallery API

Everything the server offers, read from the handlers in `server/api`. All bodies are JSON unless noted; times are unix
seconds; ids are integers. Every response carries `X-Request-Id`. Errors look like this (decision S3):

```json
{ "error": { "code": "not_found", "message": "not found" } }
```

Codes: `bad_request` (400), `not_found` (404), `conflict` (409), `too_large` (413), `bad_type` (400), `hash_mismatch`
(400), `starred_needs_confirm` (409, also carries `ids`), `rate_limited` (429), `not_configured` (503), `upstream_failed` (502), `originals_required` (400), `internal` (500). The server never touches pixels:
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
`{"version":"…","deployment":"docker|dev","engine_version":"1","updater":"ready|not installed","heartbeat_age_s":240}`.
`updater` is `ready` when the host watcher's `heartbeat` file in the signal folder is at most 30 minutes old;
`heartbeat_age_s` is omitted when there is no heartbeat.

## Updates

These talk to the host-side watcher through small files in `PIXELSORT_UPDATE_DIR` (docs/update.md). The app never names an
image and never contacts the registry. Without that folder configured, the four `/api/update/*` endpoints answer `404`.

### `POST /api/update/check`
Writes the `check` signal; the watcher then writes `available.json`. Returns `202 {"ok":true}`.

### `GET /api/update/available`
`{"available": <available.json or null>, "check_pending": true|false}`. Reads a file; no network.

### `POST /api/update/start`
Body must be exactly `{"target":"latest"}`; anything else (an image name, a digest, extra fields) is `400` and writes nothing.
Deletes any previous `result`, writes `requested` containing the word `latest`, returns `202`. Answers `409 conflict`
while an upload is in progress.

### `GET /api/update/status`
`{"pending": true|false, "result": <result or null>}`. An unreadable or invalid result is reported as
`{"status":"failed","detail":"The result file could not be read.","rollback":"unknown"}` rather than an error.

### `GET /api/busy`
`{"busy": true|false}`, true while a `POST /api/runs` is running. Answers loopback callers only (the watcher on the host);
anyone else gets `404`.

## Sharing and URL loading

These need the share Worker (`PIXELSORT_WORKER_URL` and `PIXELSORT_WORKER_SECRET`). Without it every endpoint here answers
`503` with code `not_configured`, and `GET /api/features` says so. The secret lives only in this server: the browser never
sees it or the Worker's address, and nothing here ever echoes it.

### `GET /api/features`
`{"share":true,"fetch":true,"helper":true}`; share and fetch are false when the Worker is not configured, helper when no OpenRouter key is. The web app hides share, URL-loading and Shape helper
controls when they are off.

### `POST /api/shares`
JSON `{"run_ids":[1,2],"include_recipe":false,"include_original":false,"expires_in_days":30|null,"title":"…"}`, or
`multipart/form-data` with the same JSON in a `meta` field plus one `orig-<run_id>` file per run. Uploads the results
(and thumbnails) to the Worker, then the manifest last, and records the share. Returns `201`
`{"id":"…26 chars…","url":"https://…/a/<id>","expires_at":null}`. `include_original` needs a browser re-encoded,
metadata-stripped original for every run (`400 originals_required` without them): a stored original is never sent as is.
If any upload fails the partial album is removed and nothing is recorded (`502 upstream_failed`).

### `GET /api/shares`
`{"shares":[{"id","url","created_at","expires_at","revoked_at","title","include_recipe","include_original","items","run_ids"}]}`,
newest first.

### `DELETE /api/shares/{id}`
Revokes: asks the Worker to delete the album, then marks the share revoked. `502` and no change if the Worker cannot be
reached, so it can be tried again. Revoking twice is fine.

### `POST /api/fetch`
`{"url":"https://example.com/a.png"}`. The Worker loads the picture and the response streams back with the Worker's own
status, `Content-Type` (sniffed), and `X-Source-URL`. Failures keep the Worker's codes: `link-blocked` (502),
`link-not-image` (415), `link-too-large` (413), `link-timeout` (504). At most 30 requests a minute (`429 rate_limited`).

## Shape helper

Off unless `PIXELSORT_OPENROUTER_KEY` is set (`PIXELSORT_HELPER_MODEL` picks the model; the default is `deepseek/deepseek-v4.1-flash-1017`, and it
must accept pictures). When it is off the route does not exist and `GET /api/features` says `"helper": false`. The key stays in the server: it is
never sent to the browser and never logged, and neither are prompts or pictures.

**`POST /api/helper`** (served by the app itself, not by the gallery API, so it is not in the route list)
A multipart form: `prompt` (up to 500 characters) and `image` (a PNG or JPEG copy, at most 600 KB and 768 px a side; the page sends a downscaled copy
with no camera data, and the server re-encodes it again). The answer is `application/x-ndjson`, one event per line, flushed as it happens:
`start`, `say`, `tool_start`, `tool_end`, `proposal`, then `done` (with a `reason`). The run stops if the caller disconnects, after 8 model steps, or at the deadline.
The model only proposes: the page re-runs the cut-out itself, so nothing is added until the person presses "Use it".

A request that cannot run gets a plain error envelope instead of a stream: `400` `bad_prompt` / `bad_image`, `413` `image_too_large`,
`422` `no_vision` (the model does not accept pictures), `429` `busy` (two runs at once, twelve starts a minute, server-wide), `503` `model_unavailable`.

## Runs

### `POST /api/runs`
Create a run. `multipart/form-data`: a `meta` field (JSON) first, then the files `original` (omit it when the server
already has that image: ask `POST /api/images/check`), `result` and `thumb`. `meta`:
`{"settings":{…},"seed":7,"engine_version":"1","duration_ms":123,"parent_run_id":null,"source_url":null,"title":null,
"original":{"sha256":"…","mime":"image/png","w":1,"h":1},"result":{…},"thumb":{…}}`. Hashes are lowercase SHA-256 hex and
are verified against the bytes. `settings` is a free-form JSON object (the sort params, plus `regions` and `mask` when the look
has cells or protected areas); the whole `meta` may be up to 1 MiB. `parent_run_id` names the run this one was branched from. Returns `201` with the run, or `200` with the existing run when the same original, settings,
seed and engine version were already saved (auto-save is idempotent). Errors: `400 bad_request` (bad meta, unknown original,
bad parent), `400 hash_mismatch`, `400 bad_type` (only PNG, JPEG, WebP and GIF are accepted), `413 too_large`.
`curl -F 'meta={…}' -F original=@a.png -F result=@b.png -F thumb=@t.png localhost:8895/api/runs`

### `GET /api/runs`
List with keyset pagination. Query: `cursor`, `limit` (default 60, max 200), `q` (searches the name and the recipe words:
mode, key, `45°`, `rule 110`), `starred=1`, `trashed=0|1|any` (default `0`), `sort=new|old|size`. Returns
`{"runs":[…],"next_cursor":"…"|null}`. A malformed cursor or filter is `400 bad_request`.
`curl 'localhost:8895/api/runs?limit=20&q=wave'`

### `GET /api/runs/{id}`
One run, or `404 not_found`. It also carries `"shared": true` when a live (not revoked, not expired) share contains it; trashing a shared run does not revoke the share.

### `PATCH /api/runs/{id}`
Any of `{"starred":bool,"title":string,"notes":string,"tags":[string]}`. The title is tidied like the web naming module
(control characters out, spaces collapsed, 60 code points; empty clears to the automatic name). Tags are replaced as a set
(at most 20, 40 characters each). Unknown fields are rejected. Returns the run.

### `POST /api/runs/trash`
`{"ids":[1,2],"confirm_starred":false}`. If any is starred and `confirm_starred` is not true, nothing is trashed and the
answer is `409 starred_needs_confirm` with the starred `ids`. Otherwise `{"trashed":[…],"missing":[…]}`.

### `POST /api/runs/restore`
`{"ids":[1,2]}` takes runs out of the trash. Returns `{"restored":2}`.

### `POST /api/runs/delete`
`{"ids":[1,2]}` permanently deletes the selected runs that are in the bin, re-parents their children, detaches them
from any share, and removes images nothing references anymore. Returns `{"deleted":[…],"missing":[…]}`; an id is
`missing` when it does not exist or was not in the bin, and is never deleted. Only runs already in the trash can be
deleted this way.

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
