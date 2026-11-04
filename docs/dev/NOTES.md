# Build notes

The build agent writes here; the reviewer reads here first. Newest entries at the top of each section.

## Needs Autumn

Steps only a person can do (Cloudflare, the homelab, accounts). Each line: the task id, what, and why it is waiting.

- **P0-T09** · Confirm COOP/COEP survive `tailscale serve` (steps in [`phase-0.md`](phase-0.md), P0-T09). Waiting
  on Autumn because it touches the homelab and her tailnet. Everything up to the front door is verified: `make
  spike` serves `Content-Type: application/wasm` plus all three `Cross-Origin-*` headers, and a headless
  Chromium run of `http://127.0.0.1:8895/` showed `crossOriginIsolated true`, `SharedArrayBuffer available`
  and `engine version 1`. What is unproven is only whether the HTTPS proxy passes the headers through.

## Decisions and questions

One entry per choice the agent made when the spec was unclear (format in `AGENT.md`).

## 2026-11-04 · Phase 2 results and environment notes (cloud session)

- **Numbers** (docs/perf.md, a 4-thread 2.1 GHz Xeon sandbox, Chromium 153, so slower than an M2): 2 MP `prepare` 69 ms +
  `sort` 32 ms; 8 MP 286 + 158 ms; 24 MP 823 + 535 ms. That is above PLAN.md's hoped-for ~15 ms pass at 2 MP for
  an instant sort, though the stepper (phase 3) is what the live preview runs, not this. Re-measure on your Mac.
  **Transfer strategy: copy** (view was not 20% faster at 8 MP; both give identical pixels). `/lab?transfer=view` re-tests.
- **`golangci-lint` does not run in this container** (the installed binary is built with Go 1.25, `go.mod` says 1.27).
  `make check`'s lint step is therefore unverified for everything written in the cloud session: `gofmt`, `go vet`
  and all tests pass. Run `make check` locally and fix whatever the linter finds.
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
