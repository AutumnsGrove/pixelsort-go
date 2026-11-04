# Phase 8: deploy, in-app updates, backups

**Goal.** pixelsort-go running on the homelab as a digest-pinned Docker container behind `tailscale serve`, updating
itself from Settings (or Meridian) through a host-side watcher with health check and rollback, publishing its own
image from CI, and backing up its database.

**Spec sources.** `PLAN.md` section 7 (read all of it); **`docs/update.md` (the update design; read all of it, this phase
implements it)**; `docs/deploy.md` is written in this phase. Reference implementations to read, not copy blindly:
`~/Documents/Projects/Warbler/docs/update.md` and Ivy's `update/update.go`.

**Depends on.** Phases 6 and 6b (server, Worker client). The update UI exists from phase 5 (`UpdatesBlock`, fake client).

**Hard rule for this phase.** The agent builds files in this repo and tests them with fakes. It does **not** touch the
homelab, the potato, Meridian's config, Tailscale, GHCR visibility, or any real account. Those are **[HUMAN]** tasks
(P8-T11, P8-T12). Every script is tested against fake `docker`, `curl`, `systemctl` and `sleep`.

**Exit criteria.**
1. `docker build` works for `linux/arm64` and `linux/amd64`; the container serves `/healthz`, runs read-only as a
   non-root user, and survives a restart with its data.
2. `deploy/watcher/test.sh` passes (at least 50 checks, every case listed in P8-T07).
3. The Settings Updates block works end to end against the real server and a harness that plays the watcher.
4. CI publishes the image on `main` (workflow exists; **[HUMAN]** first-run steps recorded).

Branch: `build/phase-8`.

---

### P8-T01 · `snapshot`, `healthcheck` and `starred-list` subcommands

**Why.** The final image has no shell, `wget` or `sqlite3`, so the container's own binary must do these jobs.

**Files.** `cmd/pixelsort-go/snapshot.go`, `healthcheck.go`, `starred.go`, tests.

**Spec.**
- `pixelsort-go snapshot --data DIR --out FILE`: open the database, `db.Snapshot` (`VACUUM INTO`), verify the copy opens
  and `PRAGMA integrity_check` returns `ok`, print the size. Refuses to overwrite a path that is not a regular file.
  Safe to run while the server is up (WAL).
- `pixelsort-go healthcheck [--addr 127.0.0.1:8895]`: `GET /healthz`, exit 0 if status 200 and `"status":"ok"`, else 1;
  timeout 3 s; prints one line. This is Docker's `HEALTHCHECK`.
- `pixelsort-go starred-list --data DIR`: prints, one per line, the relative blob paths of the **result images of starred,
  non-trashed runs** (for the backup script).

**Tests first.** Build a temp data dir with the phase 6 services, make runs, then: snapshot opens and has the same row count;
snapshot while a writer is active (goroutine inserting) still passes integrity; healthcheck exits 0 against `httptest` and 1 against
a closed port or a `500`; starred-list prints exactly the starred results (not trashed, not thumbs, not originals).

**Commit.** `Add snapshot, healthcheck and starred-list commands`

---

### P8-T02 · Dockerfile

**Files.** `Dockerfile`, `.dockerignore`.

**Spec.** Multi-stage, reproducible:
1. `node:22-alpine` stage: `corepack enable`, copy `web/package.json` and `pnpm-lock.yaml`, `pnpm install --frozen-lockfile`, copy
   `web/`, and the WASM from the Go stage (see below); `pnpm build` produces `web/build`.
2. `golang:1.27` stage: `CGO_ENABLED=0`; build the WASM (`GOOS=js GOARCH=wasm go build -ldflags "-s -w" -o engine.wasm ./cmd/wasm`) and
   copy Go's `wasm_exec.js`; then build the server with `-tags embedweb -trimpath -ldflags "-s -w -X
   github.com/AutumnsGrove/pixelsort-go/internal/version.Version=${VERSION}"` after the web build is copied in (use a named stage
   ordering: go-wasm -> web -> go-server).
3. Final: `gcr.io/distroless/static-debian12:nonroot` (has CA certificates for the Worker calls, no shell). Copy the binary to
   `/app/pixelsort-go`. `USER 65532:65532`. `ENV PIXELSORT_DATA=/data PIXELSORT_ADDR=0.0.0.0:8895`. `EXPOSE 8895`.
   `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/app/pixelsort-go","healthcheck","--addr","127.0.0.1:8895"]`.
   `ENTRYPOINT ["/app/pixelsort-go","serve"]`. Labels: `org.opencontainers.image.source=https://github.com/AutumnsGrove/pixelsort-go`,
   `org.opencontainers.image.version=${VERSION}`.
- `ARG VERSION=dev` passed by CI and `make image`.
- `.dockerignore`: `.git`, `node_modules`, `web/build`, `web/.svelte-kit`, `data`, `build`, `mockups`, `docs`, `*.md` (keep `LICENSE`).

**Test.** There is no unit test for a Dockerfile; the tests are commands. Add `make image` (`docker build --build-arg VERSION=$(VERSION)
-t pixelsort:dev .`) and `make image-test` (script `deploy/image-test.sh`): run the image with a temp volume, wait for health, `curl`
`/healthz`, check the headers (COOP/COEP/CSP), `curl` `/engine.wasm` content type, run a second container with `--read-only
--cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp` and confirm it still serves, stop and restart it and confirm data
survived, and confirm `docker run --rm --entrypoint /app/pixelsort-go IMAGE version` prints the version. Also build once with
`--platform linux/arm64` (QEMU emulation is fine; `docker buildx` must be available; if it is not, record that in `NOTES.md`).
Image size under 40 MB (print it).

**Verify.** `make image-test` passes. **Commit.** `Add Dockerfile and image test`

---

### P8-T03 · Compose and environment

**Files.** `docker-compose.yml` (repo root, like Polaris, so Meridian's compose actions find it), `deploy/.env.example`.

**Spec.** Service `pixelsort`: `image: ghcr.io/autumnsgrove/pixelsort@${PIXELSORT_IMAGE_DIGEST:?set by the updater}`,
`restart: always` (never signal-reload a container with `docker kill`; see PLAN.md section 7), `read_only: true`, `cap_drop: [ALL]`,
`security_opt: [no-new-privileges:true]`, `tmpfs: [/tmp]`, `ports: ["127.0.0.1:${PIXELSORT_PORT:-8895}:8895"]`,
`volumes: ["./data:/data", "./update-signal:/data/update-signal"]`, `env_file: .env`, and
`user: "${PIXELSORT_UID:-1000}:${PIXELSORT_GID:-1000}"`.

> **Why `user:` matters (a trap).** The image's default user is 65532, but the host-side watcher and backup scripts run as the
> deploy user and must read and write `data/` (restoring the database snapshot, copying it for backup). If the container
> writes files as 65532 the host user cannot touch them. Running the container as the deploy user's uid and gid fixes it.
> `install.sh` writes `PIXELSORT_UID` and `PIXELSORT_GID` into `.env`.

`deploy/.env.example` lists, with fake values and comments: `PIXELSORT_IMAGE_DIGEST`, `PIXELSORT_PORT`, `PIXELSORT_UID`, `PIXELSORT_GID`,
`PIXELSORT_BUDGET_GB`, `PIXELSORT_WORKER_URL`, `PIXELSORT_WORKER_SECRET`, `PIXELSORT_UPDATE_DIR` (default `/data/update-signal`),
`PIXELSORT_UPDATE_TAG` (default `latest`; read by the host-side watcher only, never by the app).

**Test.** `docker compose config` succeeds with a sample `.env` (script `deploy/compose-test.sh`), and a test asserts the rendered
config has the hardening options (parse `docker compose config --format json`).

**Commit.** `Add compose file and env example`

---

### P8-T04 · CI: publish the image

**Files.** `.github/workflows/docker-publish.yml`.

**Spec.** On push to `main` (after CI passes: `workflow_run` of `ci` with `conclusion == 'success'`, or a `needs` chain if you
merge the files): checkout with `fetch-depth: 0` (the version needs the commit count), compute `VERSION=r$(git rev-list --count HEAD).$(git rev-parse
--short HEAD)`, set up QEMU and Buildx, log in to GHCR with `GITHUB_TOKEN` (`permissions: packages: write, contents: read`),
build and push `linux/amd64,linux/arm64` with tags `latest` and the short sha (and `vX.Y.Z` when a `v*` git tag triggers it),
`build-args: VERSION=...`, and `cache-from/to: type=gha`. The workflow file name is **`docker-publish.yml`** (Ivy's updater waits on
that name; keep the convention). Add `workflow_dispatch`.

**Test.** Review by eye (it cannot run before push). Add `deploy/workflow-lint.sh` that runs `actionlint` if installed and otherwise
prints a notice; the reviewer will watch the first run. **[HUMAN]** after the first publish: make the GHCR package public
(or log the potato in), and link it to the repo (the `source` label does this).

**Commit.** `Add image publish workflow`

---

### P8-T05 · Update endpoints in the server

**Implements** the "What the app provides" table in `docs/update.md`.

**Files.** `server/update/update.go`, `server/api/update.go`, `server/api/busy.go`, `server/update/update_test.go`.

**Spec.**
- Config `PIXELSORT_UPDATE_DIR`. All writes are atomic (temp name then `rename`), files `0600`, directory `0700`.
- `GET /api/version`: `{version, deployment: "docker"|"dev", engine_version, updater: "ready"|"not installed", heartbeat_age_s}`;
  `updater` is `ready` when the `heartbeat` file exists and its timestamp is at most 30 minutes old.
- `POST /api/update/check`: writes `check`. `GET /api/update/available`: returns `{available: <available.json or null>,
  check_pending: <check exists>}` (reading a file the watcher wrote; **no network**).
- `POST /api/update/start`: body must be exactly `{"target":"latest"}`; anything else is `400`. Writes `requested` containing the
  word `latest`; deletes any previous `result` first (so a stale result is never read as this run's). Refuses with `409 busy` while
  an upload is in progress.
- `GET /api/update/status`: `{pending: <requested exists>, result: <result JSON or null>}`; an unreadable or invalid result file is
  reported as `{status:"failed", detail:"The result file could not be read.", rollback:"unknown"}` rather than an error.
- `GET /api/busy`: `{busy: bool}`; **only answers loopback callers** (`127.0.0.1`, `::1`; anyone else gets `404`). `busy` is true
  while any `POST /api/runs` or share upload is running (an atomic in-flight counter wrapped around those handlers).
- `/healthz` stays `{"status":"ok","version":"..."}` and nothing more.
- The app **never** accepts an image reference from anywhere and never contacts GHCR.

**Tests first.** Atomic writes (no partial file observable: write 1000 times while a reader polls); `start` with
`{"target":"ghcr.io/evil/x@sha256:..."}` is `400` and writes nothing; `start` deletes an old `result`; `start` while busy is
`409`; `available` with no file is `null`; an invalid `result` file is reported as failed, not `500`; `/api/busy` from a non-loopback
`RemoteAddr` is `404`; heartbeat 31 minutes old means `not installed`; `/healthz` body has exactly two keys.

**Commit.** `Add update endpoints`

---

### P8-T06 · The real update client in the web app, and the stale-tab banner

**Port of.** the client halves of `mockups/shared/updater.js` (`mount`, `badge`) and `mockups/tests/updater.mjs`.

**Files.** `web/src/lib/updater/http-client.ts`, `http-client.test.ts`, `StaleTabBanner.svelte`, wiring in
`UpdatesBlock.svelte` and `UpdateDot.svelte`, `web/e2e/updater.spec.ts`.

**Spec.**
- `HttpUpdateClient` implements `UpdateClient` over the five endpoints. While an update runs the page polls `/healthz`,
  **expects the server to vanish** (network errors are normal then), and reloads once `version` changes (the existing view
  model handles the states; this task connects it).
- The dot reads `GET /api/update/available` when a page opens and once an hour; it never calls `check`.
- **Stale tab:** the page remembers the version it loaded (`/healthz` at start). When a later `/healthz` reports a different
  version (poll every 5 minutes and on `visibilitychange`), show a banner "A newer version is ready. Reload" (the old tab still runs
  the old page and the old engine). Pure `staleTab(loaded, serving)` from P5-T11.

**Tests first.** Vitest with a fake `fetch`: each endpoint mapped; network failure during an update is not an error; a changed
version triggers a reload callback. Playwright against the real server with a **harness that plays the watcher** (a test helper that
writes `available.json`, waits for `requested`, writes `result`, exactly as `docs/update.md` describes): up to date, check finds one,
update succeeds and the page reloads on the new version; update fails and rolls back; rollback fails; no watcher (no heartbeat) says
"not set up"; the dot appears on Studio, phone and Archive and clears after updating; Update is disabled while an export runs.

**Commit.** `Connect Settings updates to the server`

---

### P8-T07 · The watcher

**Implements** "The watcher in detail", "Signal folder" and "Safety summary" in `docs/update.md`.

**Files.** `deploy/watcher/update.sh`, `pixelsort-update.path`, `pixelsort-update.service`, `pixelsort-tick.service`,
`pixelsort-tick.timer`, `deploy/watcher/test.sh`, `deploy/install.sh`.

**Spec (script rules).** Bash, `set -euo pipefail`, runs as the deploy user (not root), no `jq` dependency (extract the GHCR token with
`sed -n 's/.*"token":"\([^"]*\)".*/\1/p'`).
- One run at a time: `flock -n` on a lock file; a second trigger exits quietly with status 0.
- Every external command has a timeout (`timeout 300 docker compose pull`, `60` recreate, `60` snapshot, `15` GHCR lookups).
- **Resolve the digest itself** from GHCR: anonymous token from
  `https://ghcr.io/token?service=ghcr.io&scope=repository:autumnsgrove/pixelsort:pull`, then a `HEAD` of
  `https://ghcr.io/v2/autumnsgrove/pixelsort/manifests/${TAG}` with `Accept` for OCI index, Docker manifest list and Docker manifest v2,
  reading `Docker-Content-Digest`. `TAG` is `latest` unless `PIXELSORT_UPDATE_TAG` in the host's `.env` says otherwise (`^[A-Za-z0-9._-]{1,64}$`).
- The repository is **hard-coded**. The only accepted image reference is exactly `ghcr.io/autumnsgrove/pixelsort@sha256:` plus 64 lowercase
  hex characters; anything else is refused with result `failed`.
- Modes: `check` (writes `available.json` only, changes nothing), `requested` file present (update), no signal file (a bare start by Meridian
  or by hand means "update to the newest"), `--tick` (refresh `heartbeat`; act only if a signal file exists; never update on its own).
- Update order: resolve digest; wait up to 60 s for `GET http://127.0.0.1:8895/api/busy` to say not busy (then continue anyway); snapshot via
  `docker compose exec -T pixelsort /app/pixelsort-go snapshot --data /data --out /data/backups/pre-update.db`; pin the new digest in
  `.env` (`PIXELSORT_IMAGE_DIGEST=`); `docker compose pull`; `docker compose up -d --force-recreate`; poll the container health for up to
  120 s. Healthy: result `ok`. Unhealthy or any step failing: restore the snapshot (stop, copy over the database files and delete `-wal`/`-shm`,
  start), pin the **old** digest, recreate, result `failed` with `rollback` `"ok"` or `"failed"`.
- **Write a result file on every exit path** (a `trap` on `EXIT`). The message has every control character turned into a space so the file is always
  valid JSON (a real test in Warbler found a tab in Docker's output breaking it). The `requested` file is removed as the **last** step.
- Result JSON: `{ "status": "ok"|"failed"|"skipped", "detail": "...", "rollback": "ok"|"failed"|"none", "target": "<digest12>", "finished_at": "<RFC3339>" }`.
  `available.json`: `{ "current": "<12>", "latest": "<12>", "latest_digest": "sha256:...", "checked_at": "...", "update_available": true }`.

**Tests first (`deploy/watcher/test.sh`, at least 50 checks).** Put fake `docker`, `curl`, `timeout`, `sleep` and `flock`-aware wrappers first on
`PATH`; the fakes read scenario files and record calls. Cases: bare start resolves and updates; `requested` updates; `check` only writes
`available.json` and runs no `docker`; malformed digest refused; wrong repository refused; a tag with a bad character refused; GHCR unreachable
gives `failed` and touches nothing; pull fails (previous digest still pinned, container untouched); recreate fails (rollback); unhealthy after start
(snapshot restored, old digest pinned, rollback); **rollback itself fails** (distinct message and `rollback:"failed"`); second run while locked
exits 0 and writes nothing; busy wait times out after 60 s and continues; each command timeout path; a control character in a fake Docker message
still gives valid JSON (validate every written JSON file with `python3 -c 'import json,sys; json.load(open(sys.argv[1]))'` or `node`); `requested`
removed last; `--tick` refreshes `heartbeat` and does nothing else when no signal file exists; `.env` is never written with anything but the digest
line changed.

**systemd units.** `pixelsort-update.path` (`PathExists=` for `check`, and a second `PathExists=` for `requested`, in `[Path]`, triggering
`pixelsort-update.service`), the oneshot service running `update.sh` as the deploy user, `pixelsort-tick.timer` every 10 minutes
(`OnUnitActiveSec=10min`, `OnBootSec=2min`) running `update.sh --tick`.

**`deploy/install.sh`** (idempotent; **[HUMAN]** runs it): creates `update-signal/` and `data/` owned by the deploy user, writes `.env` from `.env.example`
**only if absent** (and sets `PIXELSORT_UID`/`PIXELSORT_GID`), installs the units into `/etc/systemd/system` with the right user and checkout path,
`systemctl daemon-reload`, enables `pixelsort-update.path` and `pixelsort-tick.timer`. It never overwrites `.env`. Test it in a temp root with a fake `systemctl`.

**Commit.** `Add update watcher and install script`

---

### P8-T08 · Meridian snippets

**Files.** `deploy/meridian/targets.json.snippet`, `observe.json.snippet`, `config-snippet.yaml`, `README.md`.

**Spec.** Exactly the three additions in "Using it from Meridian" of `docs/update.md`, adapted: target `pixelsort` (`kind: compose`, `dir` the
checkout, `service: pixelsort`, actions `start stop restart update`, `criticality: low`, `update: {kind: unit, unit: pixelsort-update.service}`), the
`observe.json` entry for `pixelsort-update.path`, and a tile probing `http://localhost:8895/healthz` with `version` as a vital plus a `disk_used` vital
from `/api/usage` (`used_bytes` against `budget_bytes`). Do **not** edit any Meridian repository. **[HUMAN]** applies them.

**Test.** Each JSON snippet parses (`node -e 'JSON.parse(...)'` in a script); the YAML parses.

**Commit.** `Add Meridian snippets`

---

### P8-T09 · Backups

**Files.** `deploy/backup/backup.sh`, `pixelsort-backup.service`, `pixelsort-backup.timer`, `deploy/backup/test.sh`.

**Spec (PLAN.md section 6 "Backup", decision D7).** Nightly: snapshot the database with the container's binary (`docker compose exec -T pixelsort
/app/pixelsort-go snapshot ...`), then `rclone copy` the snapshot (named with the date) and the starred results listed by `starred-list` to the
configured remote (`PIXELSORT_BACKUP_REMOTE`, for example `r2:backups/pixelsort`), keep the last 14 snapshots (delete older ones on the remote), exit
non-zero on any failure, log one summary line. Images are otherwise treated as regenerable from recipes. Timer at 03:40 daily.

**Tests first (`test.sh`, fake `docker` and `rclone`).** Snapshot called before copy; starred paths passed to `rclone`; retention keeps 14 and deletes the
rest; a failing `rclone` makes the script fail loudly; missing `PIXELSORT_BACKUP_REMOTE` is a clear error.

**Commit.** `Add backup script and timer`

---

### P8-T10 · Deployment docs

**Files.** `docs/deploy.md`, `README.md` (security section).

**Spec.** `docs/deploy.md` is the one page Autumn follows: prerequisites, the checkout location (`~/Pixelsort`), `install.sh`, first digest pin,
`tailscale serve` command, Meridian steps, backup steps, what updates automatically (the image) and what does not (the checkout: compose file, watcher
script, units; run `git pull && deploy/install.sh`), and the **drafted text** for `homelab/docs/pixelsort.md` and the port-map row for her to copy
(she approves before anyone touches the homelab repo). README: the security paragraph ("this service makes outside calls, but only to its own Worker,
carrying only what you explicitly share or fetch"; unlisted is not private; no accounts, tailnet only).

**Commit.** `Add deployment docs`

---

### P8-T11 · [HUMAN] First deploy

Autumn's checklist (the agent writes "needs Autumn" in `NOTES.md` and stops here):
1. Approve the plan; confirm port 8895 is free on the potato (`ss -ltn`).
2. Push; let CI publish the first image; make the GHCR package public; link it to the repo.
3. On the potato: clone to `~/Pixelsort`, run `deploy/install.sh`, set the Worker URL and secret in `.env`, pin a first digest, `docker compose up -d`.
4. `tailscale serve` the port; open the app over HTTPS; check `crossOriginIsolated` in the console (phase 0, P0-T09, answers this).
5. Apply the Meridian snippets; configure the backup remote; run `systemctl start pixelsort-backup.service` once and check the remote.
6. Test an update: push a trivial change, wait for CI, press Update now in Settings.
7. Deliberately publish a broken image tag (for example `broken-test`, using `PIXELSORT_UPDATE_TAG`) to watch the rollback work, then switch back.

---

### P8-T12 · [HUMAN] Homelab documentation

After step 1 of P8-T11 and her approval: copy the drafted text into the homelab repository (`docs/pixelsort.md`, the port-map row, the reserved-port note).

---

### P8-T13 · Phase wrap-up

`make check`, `make test`, `make image-test`, `bash deploy/watcher/test.sh`, `bash deploy/backup/test.sh`, `pnpm --dir web test`, `make e2e`. Tick
`PROGRESS.md`. List every **[HUMAN]** step still open in `NOTES.md` under "Needs Autumn" in the order she should do them.

**Commit.** `Finish phase 8`
