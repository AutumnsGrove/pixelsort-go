# Build notes

The build agent writes here; the reviewer reads here first. Newest entries at the top of each section.

## Needs Autumn

Steps only a person can do (Cloudflare, the homelab, accounts). Each line: the task id, what, and why it is waiting.

- **P0-T09** · Confirm COOP/COEP survive `tailscale serve` (steps in [`phase-0.md`](phase-0.md), P0-T09). Waiting
  on Autumn because it touches the homelab and her tailnet. Everything up to the front door is verified: `make
  spike` serves `Content-Type: application/wasm` plus all three `Cross-Origin-*` headers, and a headless
  Chromium run of `http://127.0.0.1:8895/` showed `crossOriginIsolated true`, `SharedArrayBuffer available`
  and `engine version 1`. What is unproven is only whether the HTTPS proxy passes the headers through.

In the order to do them (docs/deploy.md has the commands):

1. **P8-T11** · Push; let CI publish the first image; make the GHCR package public. Clone to `~/Pixelsort`, run `deploy/install.sh`, set the
   Worker URL/secret and backup remote in `.env`, pin a first digest, `docker compose up -d`, `tailscale serve`, check `crossOriginIsolated`.
2. **P6B-T09** · Cloudflare: create the `production` environment and the three secrets (docs/deploy.md, "Cloudflare"); the
   `deploy-worker` workflow does the rest on the next push to `main`. The Worker so far is a skeleton plus request signing.
3. **P8-T11 (rest)** · Apply the Meridian snippets (`deploy/meridian/`, the field names are inferred from `docs/update.md`: check them against a
   neighbouring entry), run the backup once, test an update from Settings, and deliberately publish a broken tag to watch the rollback.
4. **P8-T12** · Copy the drafted text in `docs/deploy.md` into the homelab repository, after you approve it.
5. **Optional** · Run `/lab/bench` on a phone and paste the table into `docs/perf.md`.

## Where the cloud session stopped (everything is on one branch, `build/all`, PR #1)

Done and tested: phases 2, 3, 4; phase 5's pure modules, the desktop and phone Studio, Archive and Settings; phase 6 (server T01-T14);
phase 7's whole engine side (tilings, custom polygons, classes, masks, brightest spot, session + WASM calls, goldens matching on native and
WASM) and the Pro panel; phase 8 except the two human steps and the web side of the updater (P8-T06): `snapshot`/`healthcheck`/`starred-list`,
the update endpoints, Dockerfile (built and run for real: 31 MB, read-only, restart keeps data), compose (hardening tested), publish
workflow, the watcher (104 checks against fakes), install script, backups, Meridian snippets and `docs/deploy.md`.

Not done: P8-T06 (the HTTP update client and stale-tab banner in the web app; the pure model and a fake client exist), the first-run tour,
runs strip, naming polish and the layout scan (P5-T14..T17, T22-T24); SVG import and shape library, brush painting, snap-to-shape and the
phone Shapes/Protect tabs (P7-T08, T10, T12, T13); P6-T15; phase 6b (the Worker) and phase 9. The Pro panel's protect section places ellipses
and rectangles with sliders (no on-canvas dragging yet).

## Docker in the cloud container

The preinstalled Docker has no running daemon: `nohup dockerd &` starts one. Docker Hub rate-limits this sandbox (429), so pull base images from
`mirror.gcr.io/library/<image>` and `docker tag` them locally, then build with `PIXELSORT_BUILD_FLAGS=--pull=false`. The sandbox proxy re-signs TLS,
so the build needs its CA as a secret: `PIXELSORT_BUILD_CA=/root/.ccr/ca-bundle.crt PIXELSORT_SKIP_ARM64=1 deploy/image-test.sh` (the Dockerfile
reads an optional `ca` build secret for this). The linux/arm64 build is **not verified** here; CI builds it on the first publish.

## Decisions and questions

One entry per choice the agent made when the spec was unclear (format in `AGENT.md`).

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
