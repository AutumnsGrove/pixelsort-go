# Build notes

The build agent writes here; the reviewer reads here first. Newest entries at the top of each section.

## Needs Autumn

Everything that needed a person's accounts or homelab is done except the update/rollback rehearsal.

**Done (2026-11-05):** P0-T09 (the three `Cross-Origin-*` headers and `crossOriginIsolated` through `tailscale serve`),
P6B-T09 (Worker, R2 bucket and secret; a share link was created, opened from outside the tailnet, and revoked),
P8-T11's first deploy (image, checkout, pinned digest, healthy container, serve on 8895), Meridian (tile, target and
observe entry; `meridian doctor` green and the tile shows `r126.28cd968 · 0 % disk`), the backup (one real snapshot
on R2) and P8-T12 (the homelab docs are pushed).

**Left:**

1. **P8-T11 (rest)** · Merge the open PR so `docker-publish` produces a second image, then run
   `sudo systemctl start pixelsort-update.service` on lepotato and confirm the version changes. Then publish a
   deliberately broken tag and watch the rollback (a GHCR push needs `write:packages`).
2. **Optional** · `CLOUDFLARE_API_TOKEN` on the `production` environment so `deploy-worker.yml` can deploy from CI;
   a dedicated `pixelsort-backups` bucket and R2 token instead of the interim `vaultwarden-backups` prefix;
   `/lab/bench` on a phone and the table in `docs/perf.md`.
3. Delete `DESKTOP-HANDOFF.md` when the update and rollback have both been exercised.

## 2026-11-05 · Deploy results (desktop session)

- **GHCR:** the first publish succeeded from `main`. `ghcr.io/autumnsgrove/pixelsort:latest` is public and
  multi-arch; index digest `sha256:7f8d5fcf0e84d8dd0e3fe246c1d7a1d06113ca06991f2195650863c247b02daf`.
- **Share Worker (P6B-T09):** deployed by hand with `wrangler deploy` (the GitHub secrets are still to be added).
  URL `https://pixelsort-share.m7jv4v7npb.workers.dev`; R2 bucket `pixelsort-share` created; `SHARED_SECRET` set
  from a 32-byte random value generated on Autumn's Mac and kept outside the repo. Smoke checks: `GET /a/<id>`
  `404`, unsigned `PUT /api/albums/<id>/images/0` `401`.
- **Doc fix:** the smoke-test command in `DESKTOP-HANDOFF.md` and the wording in `docs/deploy.md` used
  `PUT /a/<id>`, which is the public GET-only viewer and answers `405`. The signed upload route is
  `PUT /api/albums/<id>/images/0`. The deploy workflow already used the right route.
- **Local checks:** `make check`, `make test`, `make wasm-test`, `make image-test` (amd64 and arm64), the web
  typecheck/lint/261 tests, the worker typecheck/62 tests, `make e2e` (78) and `make e2e-worker` (3) all pass.
  `make deploy-test` (7) and `make compose-test` fail on macOS only because the shell tests use GNU `stat -c`
  and `sed -i` without a backup suffix; they pass on the Linux paths they target.
- `make e2e` does not rebuild the WASM; a stale `web/static/engine.wasm` made 16 region/brush/shape tests fail
  until `make wasm` was run. CI builds the WASM first, so this is a local-ergonomics gap only.
- **Homelab (lepotato):** checkout `/home/autumn/Pixelsort`, digest pinned, container healthy as
  `r126.28cd968`. `tailscale serve` fronts it on **8895** (443, 8891, 8892 and 8899 were already taken by
  Vaultwarden, Meridian, Warbler and Polaris). All three `Cross-Origin-*` headers survive the proxy and a
  headless Chromium reports `crossOriginIsolated: true` with `SharedArrayBuffer` available. A live Studio smoke
  test sorted, animated (ended on the instant result), tiled into hexagons (499k overlay labels) and auto-saved a run.
- **Meridian:** added the `services:` entry, the `/etc/meridian/targets.json` target and
  `pixelsort-update.path` in `observe.json`. `meridian doctor` reports url, health, build, disk and all four
  control actions ok. The repo's `config-snippet.yaml` had guessed `tiles:`/`probe:`; it now matches the real
  `services:`/`probes:` schema, and the target uses an absolute path because Meridian does not expand `~`.
- **Backup:** the only rclone credential on the box is scoped to `vaultwarden-backups`, so the interim remote is
  `r2:vaultwarden-backups/pixelsort` (a separate prefix; the first snapshot was written and verified). A
  dedicated bucket needs a new R2 API token; changing the `.env` line is then all that is required.
- **Updates:** `check` writes `available.json` (`update_available: false` at the current digest) and a requested
  update answers `skipped / Already up to date.` A real swap waits for the next publish from `main`.
- **GitHub secrets:** `CLOUDFLARE_ACCOUNT_ID` and `WORKER_SHARED_SECRET` are set on the `production`
  environment. `CLOUDFLARE_API_TOKEN` is still missing, so the `deploy-worker` workflow cannot run yet.
- **Share link (end to end):** created a 30-day album for run 1, opened the viewer, image, thumb and
  `manifest.json` from this Mac through the public Worker (all `200`, the image byte-for-byte the run's
  result), then revoked it — viewer and image both `404`. That closes the P6B-T09 exit criterion.
- **Homelab docs:** `docs/pixelsort.md` added, plus the port-map, serve-table, Services, Quick Access,
  backup, update and Meridian rows. Pushed to `AutumnsGrove/homelab` as `3ac023e`.
- **Ticked:** `P0-T09`, `P6B-T09` and `P8-T12`. `P8-T11` stays open until the update and rollback have
  both been exercised.

## 2026-11-05 · Emptying the Bin failed on shared runs

`POST /api/trash/empty` returned 500 on the live box after trashing the 24 junk runs. Root cause:
`share_items.run_id REFERENCES runs(id)` has no `ON DELETE` action, and `deleteTrashed` never detached the
victims from their shares — the two live share items (the revoked smoke-test share) blocked every run delete.
Reproduced against a copy of the live database (`FOREIGN KEY constraint failed`) and with a new regression test
that fails without the fix. Fix: delete the victims' `share_items` rows inside the same transaction before deleting
the runs; the share itself stays (revoking is separate). `TestEmptyDetachesRunsFromShares` covers it.

## 2026-11-05 · Home screen and the first-run sample

The root `/` was leftover scaffold ("pixelsort-go / Open the lab") and was invisible in practice: its content was
unpositioned while `.glow` is a fixed `z-index: 0` layer painted above it. `/` is now a real home screen (hero,
**Open Studio**, Archive and Settings cards, responsive) using the same top bar and tokens. The Studio sample is now
a real photograph (`web/static/samples/forest.jpg`, Unsplash) fetched and decoded at the working size; the old
procedural image stays as the fallback when the fetch fails. The `Load from a link` button already existed in the
dock and works now that the Worker is configured (no issue needed).

## Where the cloud session stopped (first stretch on `build/all`, PR #1; the second on `build/next`)

The desktop steps are written out command by command in `DESKTOP-HANDOFF.md` at the repository root (it deletes itself when you are done).

Done and tested: phases 2, 3, 4; phase 5's pure modules, the desktop and phone Studio, Archive and Settings; phase 6 (server T01-T14);
phase 7's whole engine side (tilings, custom polygons, classes, masks, brightest spot, session + WASM calls, goldens matching on native and
WASM) and the Pro panel; phase 8 except the two human steps and the web side of the updater (P8-T06): `snapshot`/`healthcheck`/`starred-list`,
the update endpoints, Dockerfile (built and run for real: 31 MB, read-only, restart keeps data), compose (hardening tested), publish
workflow, the watcher (104 checks against fakes), install script, backups, Meridian snippets and `docs/deploy.md`.

Later work on `build/next` finished phase 7: the geometry modules (`svg-shapes.ts`, `shape-tidy.ts`, `region-cards.ts`, `brush.ts`, shared Go/TypeScript
fixtures), region cards, the shape library with the tidy panel, brush painting with "Looks like a circle, Snap", and the phone bottom sheet with
Shapes and Protect tabs. Not done: phase 9 (P9-T01 to T10) and the small gaps in the acceptance table below.

## Docker in the cloud container

The preinstalled Docker has no running daemon: `nohup dockerd &` starts one. Docker Hub rate-limits this sandbox (429), so pull base images from
`mirror.gcr.io/library/<image>` and `docker tag` them locally, then build with `PIXELSORT_BUILD_FLAGS=--pull=false`. The sandbox proxy re-signs TLS,
so the build needs its CA as a secret: `PIXELSORT_BUILD_CA=/root/.ccr/ca-bundle.crt PIXELSORT_SKIP_ARM64=1 deploy/image-test.sh` (the Dockerfile
reads an optional `ca` build secret for this). The linux/arm64 build is **not verified** here; CI builds it on the first publish.

## Decisions and questions

One entry per choice the agent made when the spec was unclear (format in `AGENT.md`).

## 2026-11-05 · Local build: `cookie` must be a direct web dependency

The SSR output SvelteKit builds imports `cookie` as a bare specifier (Kit externalises it). pnpm's isolated
layout does not link it into `web/node_modules`, so Node resolved it from a `node_modules` in Autumn's home
directory (`cookie@1.0.2`, CJS, a transitive dependency of the `wrangler` install there) and the build failed
with "Named export 'parseCookie' not found". `web/` now depends on `cookie@^2.0.1` directly, which puts the
ESM copy in `web/node_modules` and wins over the home directory. Nothing else in the environment changed.

## 2026-11-04 · Phase 4 results

- `ca` and `ca-edges` work in both spaces; all earlier properties (plan invariants, stepper equals sort, ...) now draw CA
  recipes too (`ParamsGenNoCA` and `ErrNotImplemented` are gone). Four CA goldens added; WASM matches all 14 recipes,
  instant and stepped. Fuzz (`FuzzCARule`) clean. 8 MP plan with CA: about 170 ms (image) / 165 ms (line).
- **The plan's rule-90 test vectors were wrong** (rows 2 and 3). Re-derived by hand: `0100010` and `1010101`; the test
  carries the working. Rules 30 and 110 matched the plan.
- `Options.CAMask` is an exported hook (instead of the plan's unexported test variable) so external tests can supply a
  known mask without a package-level variable.
- **UI default recommendation: `line` space.** Rendered a synthetic landscape at angles 0 and 30 with rule 110
  (`/tmp` scratch, not committed). Image space shears the cells into thin slanted slivers at 30 degrees, which reads as
  noise; line space keeps chunky blocks aligned with the streaks, which reads as intentional. They are identical at 0,
  so nothing is lost by defaulting to `line`. Worth a look on a real photo.

## 2026-11-04 · Phase 3 results

- Stepper: odd-even, insertion, merge and reveal, mixed per region, with monotone progress and soft blending. Stepping to
  completion equals `Sort()` (property, fuzz 20 s clean, and in WASM for all ten goldens, stepped in batches of 50).
- Per-pass costs are in `docs/perf.md`. Odd-even in WASM: 4.2 ms at 1 MP, 8.7 ms at 2 MP. **Merge is the slow one**
  (21 ms/pass native at 2 MP); insertion and reveal are cheap per pass but insertion needs `n-1` passes, so on a long
  interval it takes far more passes. The UI should decide what to expose (e.g. keep merge for smaller sizes).
- Reveal's pass bound is not `maxLen+2` (it needs `intervals/6` passes); the bound tests exempt it.
- The lab's animation was checked in Chromium: every algorithm ends on the instant canvas hash.

## 2026-11-04 · Phase 2 results and environment notes (cloud session)

- **Numbers** (docs/perf.md, a 4-thread 2.1 GHz Xeon sandbox, Chromium 153, so slower than an M2): 2 MP `prepare` 69 ms +
  `sort` 32 ms; 8 MP 286 + 158 ms; 24 MP 823 + 535 ms. That is above PLAN.md's hoped-for ~15 ms pass at 2 MP for
  an instant sort, though the stepper (phase 3) is what the live preview runs, not this. Re-measure on your Mac.
  **Transfer strategy: copy** (view was not 20% faster at 8 MP; both give identical pixels). `/lab?transfer=view` re-tests.
- **The preinstalled `golangci-lint` in this container is built with Go 1.25** (`go.mod` says 1.27), so it refuses to run.
  Update: building it with the project's toolchain works:
  `GOTOOLCHAIN=go1.27.0 GOBIN=/tmp/gobin go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0`
  (the version CI uses). With that, the whole tree lints clean; CI caught what it caught before I found this.
- **`make wasm-test` fails in this container** with "total length of command line and environment variables exceeds
  limit" (the container's environment is huge); with a clean environment (`env -i ...`) it passes.
- **SvelteKit is 3.x here** (not what the plan was written against): config lives in the `sveltekit()` plugin in
  `vite.config.ts` (no `svelte.config.js`), `$lib` is gone (use `#lib/x`, mapped to `src/lib/x.ts` in package.json
  `imports`; for `.svelte` or `.js` use a relative import), and TypeScript is pinned to 5.x because Kit 3.1 needs
  its JS API. `server.headers`/`preview.headers` did not reach Kit's handlers, so a tiny plugin sets COOP/COEP.
- **Playwright**: this machine has a pre-installed Chromium; set `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`.
  CI uses `playwright install`.

## 2026-11-04 · Review of phases 0 and 1 (fixes on `fix/phase-1-review`)

Reviewed by running every check independently and probing weak spots. Verdict: sound, merged. Three findings, fixed
test-first, one commit each:

1. **`ParseParams` accepted trailing garbage** (`{} x`, `{} ]`, `{"angle":1} }`): a decoder error was read as
   "nothing follows". Now requires `io.EOF`. The old test only tried `{} {}`.
2. **`NewPlan` panicked on an `Image` whose `Pix` length disagrees with `W*H`** and tried a ~1 TB allocation for an
   over-sized one. Now returns `ErrBadSize` or `ErrBadData`. `Feather` keeps its no-error signature; its length
   precondition is documented and the session API checks mask lengths.
3. **`PartitionRegions` used maps in a per-pixel loop.** Replaced with `[256]bool` sets (same output: the
   `regions-checker` golden is unchanged). Measured with the new `BenchmarkPartitionRegions` (two angle groups):

   | Size | Before | After | Plain `Partition` |
   |---|---|---|---|
   | 1 MP | 61 ms | 11.7 ms | 2.6 ms |
   | 2 MP | 105 ms | 23 ms | 5.0 ms |
   | 8 MP | 369 ms | 121 ms | 19 ms |

   What remains is two partitions plus random-access reads along staircase lines. Not worth more work yet.

**For Autumn to decide when the UI is built:** wave intervals average about 21 px at `length` 30 (the width depends
on position along the line, so short segments are sampled more often). Only `random` has mean = `length`. Label the
wave slider "typical length", not "average".

Nits left alone: `writePNG` in the render command leaks the file if encoding fails; the test helper's "checker"
pattern is id parity rather than a true `(i+j)` checker.

## 2026-11-04 · P1-T14 · Phase 1 results

- `make check`, `make test` (with `-race`), `go test ./engine -rapid.checks=2000`, `make wasm-test` and
  `make fuzz FUZZTIME=30s` (six targets: `FuzzEngineVersionStable`, `FuzzFromRGBA`, `FuzzKeys`, `FuzzPartition`,
  `FuzzParamsJSON`, `FuzzPlanAndSort`) all pass. Coverage of `engine` is 96.4%.
- The goldens match on arm64, amd64 (Rosetta) and js/wasm under Node, against the same files.
- First numbers (Apple M2, Go 1.27.3, `make bench`): `NewPlan` 24 MP in 278 ms and `Sort` in 226 ms; 8 MP is
  88 ms and 50 ms. `Sort` allocates one output image per call — that copy is what makes the plan reusable.
- `render` was checked by eye on a 480x300 synthetic landscape at angle 45 (diagonal streaks through sky and sun,
  ridges intact) and in `edges` mode at 90 (columns, with the sun kept whole because its boundary is an edge).

## 2026-11-04 · P1-T01 · How narrowing conversions satisfy gosec

Chose: mask with the target width where the truncation is the point (`uint8(p & 0xff)` in `Unpack`), and one
central `pos32` helper carrying `//nolint:gosec // G115: positions are below MaxPixels = 2^28`. Because: G115 fires
on every `int` to `int32`/`uint8` conversion, and the engine has several that are provably in range. Alternative: an
exclusion for all of `engine/`, which would also hide a real overflow.

## 2026-11-04 · P1-T09 · Wave intervals do not average to `length`

Chose: the wave formula of decision E7 exactly, and a test that pins its *range* (about 8..56 px at `length` 30)
rather than its mean. Because: the width is a function of the position along the line, so short segments get
sampled more often than long ones and the average interval is the harmonic mean (about 21 px for `length` 30), not
the arithmetic one. `random`, which draws each width independently, is the mode whose mean equals `length` — that is
the promise PLAN.md 3.3 makes about the slider. Alternative: accumulate widths and correct, which would be a
behaviour change to a spec the mockups already show.

## 2026-11-04 · P1-T01 · Branch base for phase 1

Chose: `build/phase-1` created from `build/phase-0`, not from `main`. Because: `AGENT.md` assumes the previous
phase has been merged when the next starts, and phase 0 is still waiting for review (`P0-T09` is Autumn's). Branching
from `main` would have meant a tree with no `go.mod`. Alternative: wait for the merge, or cherry-pick phase 0 into
the new branch.

## 2026-11-04 · P0-T01 · How much of the old `.gitignore` survives?

Chose: the list from the task, plus the entries the repo already relied on (`.DS_Store`, `.env.*` with
`!.env.example`, `*.test`, `*.out`, `/bin/`), and dropped the narrower `web/static/*.wasm` because `*.wasm`
already covers it. Because: the task's list is what phase 0 needs; deleting the rest would have made the repo
start committing macOS droppings and local env files. Alternative: replace the file with the literal task list.

## 2026-11-04 · P0-T01 · `go.mod` version line

Chose: `go 1.27`, as the task says, rather than the `go 1.27.3` that `go mod init` writes. Because: the CI job
reads `go-version-file: go.mod` and should get the newest patch of 1.27, not be pinned to this machine's.
Alternative: keep the full `1.27.3`.

## 2026-11-04 · P0-T01 · `.editorconfig` beyond the letter of the spec

Chose: also set `trim_trailing_whitespace = true` (off for `*.md`, where two trailing spaces mean a line
break). Because: the spec names charset, line endings, final newline and indentation; trimming is the same
kind of hygiene and prevents noisy diffs. Alternative: only the four named settings.

## 2026-11-04 · P0-T07 · How was the spike checked without a browser on screen?

Chose: the mockups' Playwright Chromium (`mockups/tests/node_modules`) driving the real page over
`http://127.0.0.1:8895/`, with the throwaway script kept outside the repo in `/tmp`. Because: the task asks
for a person to look at the page, and a headless load answers the same question (isolated, `ping()` returns
`1`) without adding a dependency before phase 5 needs one. Alternative: leave the page unverified until
P0-T09.

## Deviations (phase 6b)

- The `shares` table has no `revoke_token` column (PLAN.md's sketch had one): only this server holds the Worker's secret, so only it can revoke.
- With `include_original`, each original is added to the album as an extra image right after its result (named "... (original)"), using the run's thumbnail as its thumbnail. The Worker has no separate original route.

## Size of a 12 MP run (P6-T15)

Measured with `pixelsort-go render` on a **synthetic** 4000×3000 "photo" (smooth colour fields, soft shapes, sensor-like noise of about
4.5 levels, slight blur), recipe `random`, 45°, length 120. I had no real photo in the cloud container, so repeat this with one of yours.

| File | Size |
|---|---|
| original, JPEG quality 90 | 1.1 MB (a real 12 MP camera JPEG is usually 3–6 MB) |
| original as PNG | 13.4 MB |
| result PNG | **26.7 MB** |
| thumbnail | tens of KB |

So one run is about **27 MB** of result plus its original (stored once however many runs use it): roughly 28–33 MB for the first run of a
picture and 27 MB for each further one. The 50 GB budget holds on the order of **1,500–1,800 runs**, which matches PLAN.md's "20–30 MB". The
render took about 3 s natively. Noise inflates PNGs; a clean, smooth photo will come in lower, a grainy one higher.

**A real photo (5 Nov 2026):** Autumn's film-scan photo of a ceiling of red maple leaves and lights, **2177×2576 (5.6 MP, not 12 MP)**, JPEG 1.1 MB,
measured with `pixelsort-go render`:

| File | Size |
|---|---|
| original JPEG | 1.1 MB |
| original as PNG | 5.5 MB |
| result PNG, `random` 45°, length 120 (4,752 lines, 22,106 intervals) | **13.0 MB** (render 1.7 s) |
| result PNG, `wave` 90°, length 300 | 7.6 MB |
| thumbnail (JPEG, 320 px) | 22 KB |

Scaled by pixel count to 12 MP (×2.14, an estimate, not a measurement): about **28 MB** and **16 MB** per result, so the synthetic figure of 27 MB
for the `random` recipe holds up for a grainy film scan. Smoother photos and longer or wave-shaped intervals come in lower. A true 12 MP
camera photo is still unmeasured.

## Mockup tests and their real counterparts (P5-T23)

The tests live in different files than the plan guessed; this is where each mockup test went. "Partial" says what is missing.

| Mockup test | Real test | Status |
|---|---|---|
| `engine-properties.mjs`, `region-properties.mjs` | Go property and fuzz tests in `engine/...` (run natively and under WASM) | Done |
| `presets.mjs` | `presets.test.ts`, the preset step in `e2e/studio.spec.ts` | Done |
| `export.mjs` | `export-model.test.ts`, the export dialog in `e2e/layout.spec.ts` and `e2e/studio.spec.ts` | Partial: no end-to-end check of an exported file's bytes yet |
| `peek.mjs` | `overlay.test.ts` + hold-T test in `e2e/regions.spec.ts`; Go `Sortable` test | Done |
| `states.mjs` | `states.test.ts`, the Archive banner in `e2e/phone.spec.ts` | Partial: not every state is driven in a browser |
| `help-settings.mjs` | `help.test.ts`, `settings.test.ts`, `tour.test.ts`, `e2e/tour.spec.ts`, shortcut checks in `e2e/studio.spec.ts` | Done |
| `errors.mjs` | `errors.test.ts`; link errors in `e2e/studio.spec.ts`, share errors in `e2e/share.spec.ts` | Partial: engine-failure dialogs are unit-tested only |
| `scale.mjs` | `runs-data.test.ts`, `e2e/strip.spec.ts` (2000 runs) | Done |
| `naming.mjs` | `naming.test.ts`, the naming test in `e2e/studio.spec.ts` | Done |
| `updater.mjs` | `updater.test.ts`, `updater/updater-flow.test.ts`, `e2e/updater.spec.ts`, `deploy/watcher/test.sh` | Done |
| `layout-scan.mjs` | `e2e/layout.spec.ts` (7 sizes, popovers, axe on each route) | Done |
| `region-algo.mjs` | Go phase 3 tests + `e2e/animate.spec.ts` | Done |
| `region-cards.mjs` | `region-cards.test.ts` (model, plus `engine/testdata/region-card-cases.json` read by Go in `engine/region_card_cases_test.go`), the cards test in `e2e/regions.spec.ts`, 44 px targets in `e2e/phone-pro.spec.ts` | Done |
| `shape-holes.mjs` | `shape-tidy.test.ts`, `e2e/svg-shapes.spec.ts` (ring counts, nesting, starters), `e2e/shape-library.spec.ts` (starters tile the picture); holes in the tiling are covered by the Go tests in `engine/shapes` | Partial: the browser does not re-check "nothing in a hole moves" or stepper == instant for holed shapes; Go does |
| `shape-tidy.mjs` | `e2e/shape-library.spec.ts` (tidy panel: holes, small holes, which pieces, simplify, cancel, add) | Partial: the phone's starter rail is the same component as Studio's, but only its visibility and tap size are checked on a phone |
| `custom-shapes.mjs` | `shape-library.test.ts` (server with a fake backend, browser fallback and retry), `e2e/shape-library.spec.ts` (paste, drop an SVG file, hostile SVG, reload keeps your shapes), `server/integration_test.go` for `/api/shapes` | Partial: no browser run against the real gallery server's `/api/shapes`; the e2e uses the browser fallback |
| `mask-editor.mjs` | `mask-model.test.ts`, `brush.test.ts` (noisy-circle and scribble properties, snap replaces the stroke), `mask-spec-cases.json` shared with Go, `e2e/regions.spec.ts` (drag, resize, rotate, nudge, delete), `e2e/brush.spec.ts` | Done |
| `phone-mask.mjs` | `e2e/phone-pro.spec.ts` (sheet, tabs, picture stays in view), the phone case in `e2e/brush.spec.ts` | Partial: painting on a phone is driven with a mouse, not real touch gestures |
