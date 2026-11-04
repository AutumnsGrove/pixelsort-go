# Phase 6b: the Cloudflare Worker (share links and URL loading)

**Goal.** One small Worker, `pixelsort-share`, with one R2 bucket of its own, that does two jobs:
1. **Share links:** store an album of finished images and serve a minimal viewer to anyone with the link.
2. **URL loading:** fetch an image from the public internet on the app's behalf, with strict guards.

Plus the potato-side half: a signing client, the `shares` tables and API, and the web share dialog.

**Spec sources.** `PLAN.md` section 6b (read all of it), decisions D3 and D4, `mockups/share.html` (the viewer's
design), `mockups/gallery.html` (share dialog and Albums tab), `mockups/shared/errors.js` (the four link-failure
messages).

**Depends on.** Phase 6 (server, blob store, runs). The web parts need phase 5.

**The rule that shapes everything:** *the Cloudflare secret lives only on the potato.* The browser never holds it.
The potato relays uploads and fetches and signs each request; the Worker rejects anything unsigned. That keeps the
Worker from being an open proxy.

**Exit criteria.**
1. `pnpm --dir worker test` green (Worker unit and integration tests, in a local workerd).
2. `go test ./server/... -race` green, including a fake-Worker test of the signing client, and a **cross-language
   signature test** (below).
3. A Playwright test drives the real Worker (`wrangler dev --local`) from the real Go server: create a share, open
   its link, see the images, revoke it, see the gone page.
4. **[HUMAN]** steps (P6B-T09) done and recorded.

Branch: `build/phase-6b`.

---

## The signing scheme (both sides implement exactly this)

Every request from the potato to the Worker carries:

| Header | Value |
|---|---|
| `X-PS-Timestamp` | Unix seconds, decimal |
| `X-PS-Content-SHA256` | lowercase hex SHA-256 of the body (of the empty string for no body) |
| `X-PS-Signature` | lowercase hex `HMAC-SHA256(secret, "PS1\n" + METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + BODYSHA)` |

`METHOD` is upper case. `PATH` is the request path **plus the raw query string if there is one**, exactly as sent
(`/fetch?url=https%3A%2F%2Fexample.com%2Fa.png`). The Worker rejects when the timestamp is more than **300 seconds**
from its own clock, when the signature does not match (compared in **constant time**), or when the body it actually
receives hashes differently from `X-PS-Content-SHA256`.

**Test vectors** (secret `test-secret`, timestamp `1700000000`; computed with Node's `crypto` when this plan was
written). Put them in `worker/test/vectors.json` and load that single file from **both** the Worker tests and the Go
tests, so the two implementations cannot drift:

```json
[
  { "name": "put image", "method": "PUT", "path": "/api/albums/abcdefghijklmnopqrstuvwxyz/images/0",
    "timestamp": "1700000000", "body": "hello",
    "bodySha": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    "signature": "a63ede7b9b11e73aa1ce4377da44e772b55a8f976c5a2aa573fff932934efe7e" },
  { "name": "delete album", "method": "DELETE", "path": "/api/albums/abcdefghijklmnopqrstuvwxyz",
    "timestamp": "1700000000", "body": "",
    "bodySha": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "signature": "bb276c0026c0e2c5587f445c70120cc9a2ad139565a72d5c2dfda7c4a590fd39" },
  { "name": "fetch with query", "method": "GET", "path": "/fetch?url=https%3A%2F%2Fexample.com%2Fa.png",
    "timestamp": "1700000000", "body": "",
    "bodySha": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "signature": "d53bd50cffecaf093e1129297c941b6cd6e51efc7c06ef7fd2868af3734751b8" }
]
```

## Routes

| Route | Auth | Does |
|---|---|---|
| `PUT /api/albums/{id}/manifest.json` | signed | store the manifest |
| `PUT /api/albums/{id}/images/{n}` and `/thumbs/{n}` | signed | store image n / its thumbnail |
| `DELETE /api/albums/{id}` | signed | revoke: delete every object under the prefix |
| `GET /fetch?url=...` | signed | the URL-loading relay |
| `GET /a/{id}` | public | the viewer page |
| `GET /a/{id}/{n}`, `/a/{id}/{n}/thumb`, `/a/{id}/manifest.json` | public, `Access-Control-Allow-Origin: *` | the files |
| anything else | | `404` |

Album ids match `^[a-z2-7]{26}$` (128 random bits in base32). Image index `n` is an integer `0..199`.

---

### P6B-T01 · Worker scaffold

**Files.** `worker/package.json`, `worker/wrangler.jsonc`, `worker/tsconfig.json`, `worker/vitest.config.ts`,
`worker/src/index.ts`, `worker/test/smoke.test.ts`, `worker/.dev.vars.example`, `worker/.gitignore` (`.dev.vars`,
`node_modules`, `.wrangler`).

**Spec.**
- `wrangler.jsonc`: `name: "pixelsort-share"`, `main: "src/index.ts"`, a current `compatibility_date`,
  `r2_buckets: [{ binding: "ALBUMS", bucket_name: "pixelsort-share" }]`,
  `triggers: { crons: ["17 3 * * *"] }` (daily expiry sweep), `vars: { MAX_FETCH_BYTES: "52428800" }`. The shared secret
  is a **secret** named `SHARED_SECRET`, never in the file; `.dev.vars.example` shows `SHARED_SECRET=dev-secret`.
- Testing uses `@cloudflare/vitest-plugin` (this changed recently; do not use the older `@cloudflare/vitest-pool-workers`
  `defineWorkersConfig` or `SELF` from the docs you may remember). `vitest.config.ts`:

```ts
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
});
```

  Tests call the Worker with `import { env, exports } from 'cloudflare:workers'` and `await exports.default.fetch(request)`;
  `env.ALBUMS` is the R2 bucket. **If an import fails, look up the current API** (the Context7 library is
  `/cloudflare/workers-sdk`, package `packages/vitest-plugin`) rather than guessing, and note the correction in `NOTES.md`.
  Set `SHARED_SECRET` for tests through the plugin's `miniflare.bindings` option.
- `src/index.ts` exports `{ fetch, scheduled }`; `fetch` is a small router returning `404` for everything for now.

**Tests first.** `smoke.test.ts`: `GET /` is `404`; `GET /a/abcdefghijklmnopqrstuvwxyz` is `404` (nothing stored yet).

**Verify.** `pnpm --dir worker install && pnpm --dir worker test && pnpm --dir worker exec tsc --noEmit`.

**Commit.** `Add Worker scaffold`

---

### P6B-T02 · Request signing (both languages)

**Files.** `worker/src/auth.ts`, `worker/test/auth.test.ts`, `worker/test/vectors.json`,
`server/share/sign.go`, `server/share/sign_test.go`.

**Spec.** `auth.ts`: `verify(request, secret, nowSeconds): Promise<'ok' | 'missing' | 'stale' | 'bad-signature' | 'bad-body'>`
using Web Crypto (`crypto.subtle.importKey` + `sign`) and a constant-time compare. For requests with a body it must
**stream-hash** the body (`crypto.DigestStream`) while it is consumed by the route handler: provide
`verifiedBody(request, expectedSha): ReadableStream` that errors if the final hash differs, and for the R2 put use the
`sha256` option of `bucket.put` (R2 checks the checksum itself) so a bad body is rejected by R2.
`sign.go`: `Sign(secret, method, path string, ts time.Time, bodySHA string) (headers http.Header)` and `Client` helper that
adds the three headers to an `*http.Request`.

**Tests first.** Both suites load `vectors.json` and check every vector: the Go signer reproduces each `signature`;
the Worker verifier accepts each and rejects a one-character change in method, path, timestamp, body hash or signature
(five mutations per vector). Worker: a timestamp 301 seconds old is `stale`, 299 is fine, a missing header is `missing`,
two requests with different secrets are `bad-signature`. Constant-time compare is used (assert the function exists and is
exercised; a unit test with equal-length different strings is enough).

**Commit.** `Add request signing in Worker and Go`

---

### P6B-T03 · Album upload and revoke

**Files.** `worker/src/albums.ts`, `worker/test/albums.test.ts`, `worker/src/validate.ts`.

**Spec.** R2 keys: `albums/{id}/manifest.json`, `albums/{id}/images/{n}`, `albums/{id}/thumbs/{n}`.
- All routes here require a valid signature (`401` JSON `{"error":...}` otherwise).
- `validate.ts`: `isAlbumId`, `isIndex`; manifest must be JSON of the shape
  `{ v:1, created:<unix>, expires:<unix>|null, title?:string, images:[{ w,h,name?,recipe?,mime }] }` with at most 200
  images, `name` <= 60 code points, `recipe` an object (only present when the user opted in), `mime` one of
  `image/png|jpeg|webp`; total manifest size <= 256 KB.
- Image and thumb objects: allowed `Content-Type` `image/png|jpeg|webp`, **max 30 MB** per object, stored with
  `httpMetadata.contentType`. Verify the declared SHA-256 through R2's checksum option; a mismatch is `400 hash_mismatch`.
- `DELETE /api/albums/{id}`: list the prefix `albums/{id}/` **with cursor loops** (R2 lists up to 1000 per call) and delete
  in batches of up to 1000 keys; idempotent (`204` even if nothing exists).

**Tests first.** Upload manifest and two images, read them back from `env.ALBUMS`; unsigned is `401`; bad album id `400`;
`n = 200` `400`; wrong content type `415`; 31 MB body `413`; hash mismatch `400` and the object is not stored; manifest
with 201 images or a `<script>` in `name` is accepted only if `name` is text (it is stored as data; escaping happens at
render, tested in P6B-T04); revoke deletes 1500 objects (seed them directly; proves the cursor loop) and a second revoke
is `204`.

**Commit.** `Add album upload and revoke`

---

### P6B-T04 · The public viewer and file routes

**Port of.** `mockups/share.html` (including the "gone" state), `mockups/tests` where it applies.

**Files.** `worker/src/viewer.ts`, `worker/src/public.ts`, `worker/test/public.test.ts`.

**Spec.**
- `GET /a/{id}/manifest.json`, `/a/{id}/{n}`, `/a/{id}/{n}/thumb`: public; `Access-Control-Allow-Origin: *`,
  `Cross-Origin-Resource-Policy: cross-origin`, `Cache-Control: public, max-age=3600` for files, `no-cache` for the
  manifest; `Content-Type` from R2 metadata; `X-Content-Type-Options: nosniff`; ranges supported (pass `Range` to
  `bucket.get`). Missing object, revoked or **expired** album: `404`.
- `GET /a/{id}`: the viewer page: server-rendered HTML string (no framework), a grid of thumbnails, a lightbox with
  zoom/inspect, download buttons, "copy image link", and "copy recipe" **only if** the manifest has recipes. Port the
  design of `mockups/share.html` (Theater look: ink background, serif display, mono; fonts **not** loaded from Google:
  use system serif and monospace stacks here, no third-party requests). All dynamic text goes through one
  `escapeHtml` function; recipes are embedded as a `<script type="application/json">` block with every `<` written as the JSON escape `<` (so `</script>` cannot close the block).
  Strict CSP: `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self' 'nonce-<random>'`
  (a fresh nonce per response). The page shows an expiry note when `expires` is set.
- The **gone page** (revoked, expired or never existed) is one page, status `404`, with no hint which of the three it was.
- Expiry is checked on read: if `manifest.expires` is in the past, treat as gone and delete the prefix in the background
  (`ctx.waitUntil`).

**Tests first.** Viewer HTML for a manifest containing `<img src=x onerror=alert(1)>` as a name renders the text escaped
(assert the raw string never appears unescaped); a recipe containing `</script><script>alert(1)` stays inside the JSON
block; CORS header on files; `Range` works; expired album is `404` and its objects are deleted after
`waitOnExecutionContext`; revoked is `404`; gone page identical for missing and expired; every response has
`nosniff` and the CSP with a nonce that changes between requests.

**Commit.** `Add public share viewer`

---

### P6B-T05 · Scheduled expiry sweep

**Files.** `worker/src/scheduled.ts`, `worker/test/scheduled.test.ts`.

**Spec.** The `scheduled` handler lists `albums/` with `delimiter: "/"` to get album prefixes (cursor loops), reads each
`manifest.json`, and deletes the albums whose `expires` is in the past. Albums with no manifest older than 24 hours
(an interrupted upload) are deleted too. Bounded work per run (at most 200 albums per invocation; the next run
continues). Never throws on a malformed manifest (log and skip).

**Tests first.** Call the handler directly (the plugin exposes `createScheduledController` and
`createExecutionContext`/`waitOnExecutionContext` in `cloudflare:test`; check the docs if the names changed):
expired deleted, future kept, `expires: null` kept, malformed manifest skipped, 250 albums need two runs.

**Commit.** `Add expiry sweep`

---

### P6B-T06 · URL loading relay

**Files.** `worker/src/fetch.ts`, `worker/test/fetch.test.ts`.

**Spec.** `GET /fetch?url=<encoded>` (signed). Guards, in order:
1. `url` parses; scheme is `http` or `https` only; no username or password in the URL; port is empty, 80 or 443;
   host is not an IP literal in a private, loopback or link-local range (defence in depth: Cloudflare cannot reach
   the LAN anyway) and not `localhost`.
2. Fetch with `redirect: "manual"`; follow up to **5** redirects yourself, re-validating **every** hop against rule 1;
   send **no** cookies and **no** `Authorization`; a fixed polite `User-Agent: pixelsort-go/1`.
3. Timeout **15 s** total (`AbortController`).
4. Response must be `2xx`. Stream the body through a counter: abort past `MAX_FETCH_BYTES` (default 50 MB).
5. **Content type must be an allowed image** and must be **sniffed**, not trusted: check the first 16 bytes for PNG
   (`89 50 4E 47`), JPEG (`FF D8 FF`), GIF (`GIF8`), WebP (`RIFF....WEBP`), AVIF (`....ftypavif`). The header and the sniff
   must agree on "an image"; the **sniffed** type is what is returned as `Content-Type`.
6. Return the bytes with `X-Source-URL` (the final URL) and `Cache-Control: no-store`.

Errors are JSON `{"error":{"code","message"}}` with codes matching the web catalog: `link-blocked` (blocked by the site:
`401`, `403`, `451`, connection refused, or a guard rejection), `link-not-image` (`200` but not an image),
`link-too-large`, `link-timeout`; HTTP statuses `502`, `415`, `413`, `504` respectively.

**Tests first** (stub `globalThis.fetch` with `vi.spyOn`; no network): each guard (a `file:` URL, `ftp:`, URL with
credentials, port 8080, `http://127.0.0.1`, `http://[::1]`, `http://10.0.0.1`, `http://169.254.169.254/latest`, `localhost`);
redirect to a private IP is blocked at the second hop; six redirects fail; a 51 MB stream aborts without buffering it
all (assert the stream was cancelled); `Content-Type: image/png` with HTML bytes is `link-not-image`; `Content-Type:
text/html` with PNG bytes is also rejected (header and sniff must agree); cookies and `Authorization` are not forwarded
(inspect the stub's request); timeout produces `link-timeout`; a valid PNG round-trips and returns the sniffed type.

**Commit.** `Add URL loading relay`

---

### P6B-T07 · The potato side: client, tables, API

**Files.** `server/db/migrations/0002_shares.sql`, `server/share/client.go`, `server/share/service.go`,
`server/api/shares.go`, `server/api/fetch.go`, tests; `server/config.go` (extend).

**Spec.**
- Config (secrets only on the potato): `PIXELSORT_WORKER_URL` (https, no trailing slash) and
  `PIXELSORT_WORKER_SECRET`. If either is unset the share and fetch endpoints return `503 not_configured` and the app
  hides share UI (the web reads `GET /api/features`: `{share:bool, fetch:bool}`).
- Migration:

```sql
CREATE TABLE shares (
  id INTEGER PRIMARY KEY, share_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, expires_at INTEGER,
  include_recipe INTEGER NOT NULL, include_original INTEGER NOT NULL, title TEXT, revoked_at INTEGER);
CREATE TABLE share_items (
  share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE, run_id INTEGER NOT NULL REFERENCES runs(id),
  position INTEGER NOT NULL, PRIMARY KEY (share_id, position));
```

  (No `revoke_token` column: only the potato can revoke, because only it holds the secret. PLAN.md's sketch had one;
  this replaces it. Record in `NOTES.md`.)
- `POST /api/shares` `{run_ids:[...], include_recipe, include_original, expires_in_days|null, title?, stripped_originals?}`:
  generates a 26-char base32 id from `crypto/rand`, reads each run's result and thumbnail **from the blob store**
  (streaming, not buffered), uploads manifest and files with the signed client (retrying idempotent PUTs up to 3 times),
  stores the rows, and returns `{id, url, expires_at}`. If any upload fails, it revokes the partial album and returns
  `502`; no `shares` row is left. **Originals:** the server cannot strip metadata without decoding pixels, so when
  `include_original` is true the **browser sends re-encoded, metadata-stripped originals** in `stripped_originals`
  (multipart parts named `orig-<run_id>`); the server refuses `include_original` without them
  (`400 originals_required`) and **never uploads a stored original as is**.
- `GET /api/shares` (list with item counts), `DELETE /api/shares/{id}` (revoke: signed `DELETE` to the Worker, then set
  `revoked_at`; if the Worker is unreachable, return `502` and leave the row unrevoked so it can be retried).
- `POST /api/fetch` `{url}`: signs a `GET /fetch?url=...` to the Worker and **streams** the response back, preserving
  the error codes and statuses of P6B-T06. The browser never sees the Worker URL or secret. Limit: 30 requests per
  minute per process (token bucket) so a bug cannot hammer the Worker; over the limit is `429 rate_limited`.
- Trashing a run that is in a live share does **not** revoke it; the API just reports it (`GET /api/runs/{id}` includes
  `shared: true` when a non-revoked, non-expired share contains it).

**Tests first.** A fake Worker (`httptest`) that verifies signatures with the shared `vectors.json` logic: create share
uploads manifest + N images + N thumbs with valid signatures and the right bodies; recipe present only with
`include_recipe`; a failing second image revokes the album and leaves no row; revoke calls `DELETE` and sets
`revoked_at`; an unreachable Worker on revoke leaves the row; `include_original` without stripped parts is
`400 originals_required`; `/api/fetch` streams a body and maps each error code; the rate limit triggers at 31 requests
(fake clock); with no config every endpoint is `503` and `/api/features` says so; **the secret never appears** in any
response body, header or log line (capture logs in the test and grep).

**Commit.** `Add share and fetch API on the server`

---

### P6B-T08 · Web: share dialog, Albums, URL loading

**Port of.** the share parts of `mockups/gallery.html` and `mockups/studio.html`, `mockups/tests` equivalents.

**Files.** `web/src/lib/components/ShareDialog.svelte` (finish), `Albums.svelte`, `web/src/lib/share.ts`,
`share.test.ts`, `web/src/lib/intake.ts` (extend), `web/e2e/share.spec.ts`, Playwright config project `worker`.

**Spec.**
- Share dialog: choose what to include (results always; recipe and original opt-in; original off by default), expiry
  (never / 30 days, default from Settings), create, copy link, and a plain statement "anyone with the link can see
  this; it is unlisted, not private". When "include original" is on, the browser re-encodes each original through a
  canvas (this strips EXIF/GPS) and sends it as `orig-<run_id>`.
- Albums tab lists shares with revoke (confirm), item counts and expiry; revoked shares are shown struck through.
- Warn before trashing a run that is in a live share ("the shared copy stays up until you revoke it").
- URL loading: direct `fetch` first; on a CORS or network failure call `POST /api/fetch`. Map the four failure codes to
  the catalog dialogs from P5-T07. Your own share links load directly (the files send CORS `*`): "download the project,
  fetch the image URL" works with no proxy.
- Hide all share and fetch UI when `/api/features` says they are off.

**Tests first.** Vitest: re-encoded original has no EXIF (feed a JPEG with an EXIF block built in the test, assert the
output lacks the `Exif` marker); the share request body for each option combination; failure-code mapping; features-off
hides UI. Playwright (starts the real Worker with `wrangler dev --local --port 8787` using `.dev.vars`, and the Go server
configured to it): create a share of two runs, open the share URL in a **second browser context with no cookies**, see
both images and working download links, copy recipe appears only when included, revoke in the app, the share URL now shows
the gone page, and the R2 prefix is empty.

**Commit.** `Add share dialog, Albums and URL loading`

---

### P6B-T09 · [HUMAN] Cloudflare setup and deploy

The agent skips this and writes one line under "Needs Autumn" in `NOTES.md`. Autumn's steps (she still owes the
decisions: worker name and account, custom domain or `workers.dev`, default expiry):

1. `cd worker && pnpm exec wrangler login`.
2. `pnpm exec wrangler r2 bucket create pixelsort-share`.
3. `openssl rand -hex 32 | pnpm exec wrangler secret put SHARED_SECRET` (and keep the same value for the potato's
   `PIXELSORT_WORKER_SECRET`).
4. `pnpm exec wrangler deploy`. Note the URL (`https://pixelsort-share.<account>.workers.dev`, or attach a custom domain
   in the dashboard).
5. On the potato: set `PIXELSORT_WORKER_URL` and `PIXELSORT_WORKER_SECRET` in `~/Pixelsort/.env` (phase 8).
6. Smoke test by hand: `curl -s https://<worker>/a/abcdefghijklmnopqrstuvwxyz -o /dev/null -w '%{http_code}\n'` prints `404`;
   an unsigned `PUT /api/albums/...` prints `401`.

**Commit.** none.

---

### P6B-T10 · Phase wrap-up

`make check`, `make test`, `pnpm --dir worker test`, `make e2e`. Add a CI `worker` job (setup-node 22, install, `tsc`,
`test`). Tick `PROGRESS.md`. Write the README security paragraph the plan asks for ("this service makes outside calls,
but only to its own Worker, and only carrying what the user explicitly shares or fetches").

**Commit.** `Finish phase 6b`
