# Phase 2: the engine in the browser, and the numbers

**Goal.** The Go engine running as WebAssembly in a web worker, a promise-based client for it, a bare lab
page where one photo sorts in the browser, and measured numbers that settle two open questions from PLAN.md:
how pixels get from Go to the canvas (zero-copy view or copy), and how long a pass really takes.

**Depends on.** Phase 1 (the engine) and Phase 0 (`make wasm`).

**Exit criteria.**
1. A photo dropped on `/lab` sorts in the browser, in a worker, and the page stays responsive.
2. The WASM output equals the native goldens (`web/scripts/wasm-golden.mjs` passes).
3. `docs/perf.md` records the measurements and the chosen pixel-transfer strategy.
4. `make e2e` passes the lab smoke test; CI runs it.

Branch: `build/phase-2`.

---

## Shape of this phase

```
web/src/lib/engine/protocol.ts    message types between page and worker
web/src/lib/engine/worker.ts      module worker: loads wasm_exec + engine.wasm, handles messages
web/src/lib/engine/client.ts      EngineClient: promises, latest-wins, timing
web/src/lib/engine/vendor/wasm_exec.js   Go's loader, copied by `make wasm` (committed)
engine/api/session.go             pure Go: the whole boundary, testable natively
cmd/wasm/main.go                  thin syscall/js binding over engine/api
web/src/routes/lab/+page.svelte   the bare page
```

Why `engine/api` exists: `cmd/wasm` only compiles for `js/wasm`, so logic placed there cannot be unit tested
natively. All behaviour lives in `engine/api` (plain Go, tested like everything else); `cmd/wasm` only converts
between JavaScript values and Go values. Keep it that thin.

---

### P2-T01 · The session API (pure Go)

**Goal.** The coarse boundary from PLAN.md section 5 (decision B1) as ordinary Go.

**Files.** `engine/api/session.go`, `engine/api/session_test.go`, `engine/api/session_fuzz_test.go`.

**Spec.**

```go
package api

type Session struct { /* current image, params JSON-decoded, plan, result */ }

func NewSession() *Session
func (s *Session) Init(w, h int) error                       // allocates an empty working image; replaces any previous state
func (s *Session) SetImage(rgba []byte) error                // len must be 4*w*h; copies
func (s *Session) SetRegions(labels []uint16, classOf []uint8, defsJSON []byte) error // optional; defsJSON is a JSON array of ClassDef; nil clears
func (s *Session) SetMask(mask []uint8) error                // optional frozen mask; nil clears
func (s *Session) SetSoft(radius int) error                  // feather radius; 0 clears (needs a mask)
func (s *Session) Configure(paramsJSON []byte) error         // engine.ParseParams
func (s *Session) Prepare() (engine.Stats, error)            // NewPlan with everything set so far
func (s *Session) FinishInstant() error                      // plan.Sort(); result becomes the current pixels
func (s *Session) Pixels() []uint32                          // the current pixel buffer (original until FinishInstant)
func (s *Session) Size() (w, h int)
func Version() string                                        // engine.EngineVersion
```

Rules: calls out of order return a sentinel `ErrState` (`Prepare` before `Configure`, `FinishInstant` before
`Prepare`, `SetImage` before `Init`, ...). `Configure` after `Prepare` invalidates the plan (the next
`FinishInstant` needs a new `Prepare`). `Session` never panics on bad input; it returns errors with context.
Phase 3 adds `Step`, `Progress` and `Reset`.

**Tests first.**
- Lifecycle table: each call out of order gives `ErrState`; the happy path works.
- `TestInstantMatchesEngine`: `Init, SetImage, Configure, Prepare, FinishInstant` on `testutil.Gradient(97,61,3)` with a
  recipe from the golden table gives pixels whose SHA-256 equals that golden's. (This is the native half of the WASM
  equivalence check.)
- `TestConfigureInvalidatesPlan`, `TestSetImageWrongLength`, `TestSetRegionsBadLabels`, `TestSetMaskWrongLength`.
- `TestReinitReplacesState`: `Init` with a new size drops the old image, plan and result.
- `FuzzSession(data []byte)`: interpret bytes as a short script of calls with small clamped sizes; no panic, no
  deadlock, and after any `FinishInstant` the pixels are a permutation of the image set.

**Verify.** `go test ./engine/... -race`; fuzz 20s.

**Commit.** `Add engine session API`

---

### P2-T02 · The WASM binding

**Goal.** Expose the session to JavaScript with no behaviour of its own.

**Files.** `cmd/wasm/main.go` (rewrite the phase 0 stub), `cmd/wasm/convert.go` (build tag `js && wasm`).

**Spec.** On `globalThis.pixelsort`, functions that **never throw and never panic**. Each returns a plain object:
`{ ok: true, ... }` or `{ ok: false, error: "message" }`. Wrap every handler in a function that `recover`s a
panic and turns it into `{ ok: false, error: "internal: ..." }`; a panic escaping a `js.Func` kills the whole Go
runtime, so this wrapper is mandatory.

| JS name | Arguments | Returns (ok case) |
|---|---|---|
| `version()` | | `{ok, version}` |
| `init(w, h)` | numbers | `{ok}` |
| `setImage(u8)` | `Uint8Array` or `Uint8ClampedArray`, RGBA | `{ok}` |
| `setRegions(labelsU16, classU8, defsJson)` | typed arrays + string (or `null`s to clear) | `{ok}` |
| `setMask(u8)` | `Uint8Array` or `null` | `{ok}` |
| `setSoft(radius)` | number | `{ok}` |
| `configure(json)` | string | `{ok}` |
| `prepare()` | | `{ok, stats: {lines, intervals, sortable, frozen}}` |
| `instant()` | | `{ok}` |
| `pixelsPtr()` | | `{ok, ptr, len}` (byte address in Go's linear memory, byte length) |
| `copyPixels(dstU8)` | `Uint8Array` of exactly `4*w*h` | `{ok}` (uses `js.CopyBytesToJS`) |

Copy typed arrays in with `js.CopyBytesToGo`. Turning `[]uint32` into the `[]byte` that `CopyBytesToJS` needs, and
into a stable address for `pixelsPtr`, uses `unsafe`: confine it to `convert.go` with one `//nolint:gosec` that
says why (single-threaded WASM, little-endian, the slice stays referenced by the session so the address is
stable until the next `Init`/`SetImage`).

**Tests.** Not unit-testable natively. Covered by P2-T07 (Node, golden hashes) and P2-T08 (browser). Write the
Node script from P2-T07 *before* this task and watch it fail first.

**Verify.** `make wasm` builds; `make hello` still passes (`ping` can remain as an alias of `version`).

**Commit.** `Add WASM binding for the session API`

---

### P2-T03 · The web app scaffold

**Goal.** A SvelteKit project that builds to static files, with unit and browser tests wired up.

**Files.** `web/package.json`, `web/svelte.config.js`, `web/vite.config.ts`, `web/tsconfig.json`,
`web/src/app.html`, `web/src/routes/+layout.ts`, `web/src/routes/+page.svelte`, `web/playwright.config.ts`,
`web/.prettierrc`, `web/eslint.config.js`, `pnpm-lock.yaml` (committed).

**Spec.**
- pnpm, TypeScript strict (`strict`, `noUncheckedIndexedAccess`), Svelte 5, `@sveltejs/adapter-static` with
  `fallback: 'index.html'` (single-page app), `export const ssr = false` in `+layout.ts`.
- Scripts: `dev`, `build`, `preview`, `check` (`svelte-check`), `lint`, `test` (`vitest run`), `e2e`
  (`playwright test`).
- Vitest: `include: ['src/**/*.test.ts']`, environment `node` by default (component tests are not planned; logic
  lives in plain modules).
- Playwright: Chromium only; `webServer` runs `pnpm build && pnpm preview --port 4173`; `baseURL`
  `http://127.0.0.1:4173`; **headers**: add a Vite `preview.headers` and `server.headers` entry with the three
  `Cross-Origin-*` headers so the lab is cross-origin isolated in tests too.
- Create the project by hand (or with the SvelteKit CLI) and then edit to match this list. The route `/` shows the
  app name and a link to `/lab`.
- Update `Makefile`: `web`, `web-test`, `e2e` already exist from phase 0; make `make wasm` also copy
  `build/engine.wasm` to `web/static/engine.wasm` and `wasm_exec.js` to `web/src/lib/engine/vendor/wasm_exec.js`.
  Commit the vendored `wasm_exec.js` (it is Go's BSD-licensed loader; keep its header). Do not commit
  `web/static/engine.wasm`.

**Test first.** `web/src/lib/smoke.test.ts` with `expect(1 + 1).toBe(2)` proves Vitest runs; replace it in the next
task. A Playwright test `e2e/home.spec.ts` that loads `/` and expects the app name and the `/lab` link.

**Verify.** `pnpm --dir web install --frozen-lockfile`, `pnpm --dir web check`, `pnpm --dir web test`,
`pnpm --dir web build` all pass; `make e2e` passes.

**Commit.** `Add web app scaffold`

---

### P2-T04 · Worker, protocol and client

**Goal.** `EngineClient`: a typed, promise-based wrapper over the worker with latest-wins scheduling.

**Files.** `web/src/lib/engine/protocol.ts`, `worker.ts`, `client.ts`, `go.d.ts`, `client.test.ts`.

**Spec.**

`protocol.ts`: a discriminated union.

```ts
export type Request =
  | { id: number; type: 'init'; w: number; h: number }
  | { id: number; type: 'setImage'; rgba: ArrayBuffer }            // transferred
  | { id: number; type: 'setRegions'; labels: ArrayBuffer | null; classOf: ArrayBuffer | null; defsJson: string | null }
  | { id: number; type: 'setMask'; mask: ArrayBuffer | null }
  | { id: number; type: 'setSoft'; radius: number }
  | { id: number; type: 'configure'; json: string }
  | { id: number; type: 'run' }                                     // prepare + instant, returns pixels
export type Response =
  | { id: number; ok: true; stats?: Stats; rgba?: ArrayBuffer; timings?: Timings }
  | { id: number; ok: false; error: string }
export type Stats = { lines: number; intervals: number; sortable: number; frozen: number }
export type Timings = { prepareMs: number; sortMs: number; transferMs: number }
```

`worker.ts` (module worker): `import './vendor/wasm_exec.js'`, then
`WebAssembly.instantiateStreaming(fetch(new URL('/engine.wasm', self.location.origin)), go.importObject)`,
`go.run(instance)`, wait for `self.pixelsortReady`. It processes **one message at a time in arrival order**
(`onmessage` is already serial). `run` calls `prepare`, `instant`, then gets pixels with the strategy chosen in
P2-T06 (start with `copyPixels` into a fresh `ArrayBuffer`, transferred back, zero-copy for the page) and measures
each stage with `performance.now()`.

`client.ts`:

```ts
export class EngineClient {
  constructor(workerFactory?: () => Worker)       // injectable for tests
  ready(): Promise<void>
  init(w: number, h: number): Promise<void>
  setImage(rgba: Uint8ClampedArray): Promise<void> // copies then transfers; the caller's array stays valid
  configure(params: Partial<Params>): Promise<void> // merges into the last params, sends JSON
  run(): Promise<{ rgba: Uint8ClampedArray; stats: Stats; timings: Timings } | 'superseded'>
  dispose(): void
}
```

**Latest wins.** Go cannot be interrupted mid-sort, so cancellation means *coalescing*: while a `run` is in flight,
further `run()` calls do not queue one-for-one; keep only the newest pending and resolve all older pending ones with
`'superseded'`. When the in-flight run finishes, start the newest pending. A rejected request (the worker reports
`ok:false`) rejects its promise with an `Error` carrying the message. If the worker itself errors or exits, every
pending promise rejects with `EngineCrashed`, and the next call starts a fresh worker.

`Params` is a TypeScript mirror of `engine.Params` (same field names, same ranges) with a `defaultParams` and a
`validateParams` that applies the same ranges as Go. Keep it in `web/src/lib/engine/params.ts` and test the ranges
against a table shared with Go: write the table once as `engine/testdata/params-cases.json` (case name, JSON,
valid or not) and load it in both test suites.

**Tests first** (`client.test.ts`, a fake `Worker` object that records messages and replies on demand):
- Requests carry increasing ids and responses resolve the right promise, even when answered out of order.
- Three `run()` calls issued while the first is in flight: the first resolves, the second resolves `'superseded'`,
  the third runs and resolves with data.
- `setImage` does not detach the caller's array.
- An `ok:false` response rejects with the message; a worker `error` event rejects all pending with `EngineCrashed`
  and the next call creates a new worker via the factory.
- `configure` merges and sends full JSON each time.
- `params-cases.json` agrees with `validateParams` for every case.
Also add the Go side: `engine/params_cases_test.go` loads the same file and asserts `ParseParams` accepts or
rejects each case.

**Verify.** `pnpm --dir web test`; `go test ./engine -run ParamsCases`.

**Commit.** `Add engine worker, protocol and client`

---

### P2-T05 · The lab page

**Goal.** A bare page that proves the loop: load a photo, sort it, see it, with timings.

**Files.** `web/src/routes/lab/+page.svelte`, `web/src/lib/engine/image-intake.ts`, `image-intake.test.ts`.

**Spec.**
- Image intake: a file input, drag-and-drop anywhere on the page, and paste. Decode with `createImageBitmap`
  (it respects EXIF orientation with `imageOrientation: 'from-image'`). Reject non-images with a visible message.
- **Working copy** (PLAN.md P3): scale so the long edge is at most 1920 px (1280 if `matchMedia('(max-width: 700px)')`
  or `navigator.hardwareConcurrency <= 4 && /Mobi/.test(navigator.userAgent)`), never upscale, keep the aspect
  ratio, via an `OffscreenCanvas` (fall back to a canvas element). The pure part, `workingSize(w, h, longEdge)`,
  lives in `image-intake.ts` and is unit-tested (same cases as `workCopy` in `mockups/tests/help-settings.mjs`,
  plus `1xN`, `Nx1`, and sizes below the cap).
- Controls (plain HTML, no styling effort): mode (`random`, `wave`, `threshold`, `edges`, `none`), key, angle
  (number input and range), length, randomness, lo, hi, edge, seed, reverse. Changing any control re-runs after a
  100 ms debounce (latest wins).
- Two canvases, "original" and "sorted", drawn with `putImageData`. A readout shows `stats` and the three
  timings from the last run, plus image size and working size.
- Errors from the engine show in a visible element (`role="alert"`).

**Tests first.** `image-intake.test.ts` for `workingSize`. An e2e test is P2-T08.

**Verify.** `pnpm --dir web test`; run `make wasm && pnpm --dir web dev`, drop a real photo on `/lab`, and
confirm by eye that it sorts and the page stays responsive while dragging the length slider.

**Commit.** `Add lab page`

---

### P2-T06 · Measure: zero-copy or copy, and what a pass costs

**Goal.** Answer PLAN.md section 5 with numbers.

**Files.** `web/scripts/bench.mjs`, `docs/perf.md`, `web/src/routes/lab/bench/+page.svelte` (optional page the
script drives), changes to `cmd/wasm` and `worker.ts` to expose the winning strategy.

**Spec.** A headless-Chromium script (Playwright, already a dev dependency) that, for synthetic images of 1, 2, 8
and 24 megapixels, runs each of these **10 times** and records the **median** and the worst:
1. `prepare` (plan build) and `instant` (sort) inside Go (already timed by the worker).
2. **Copy strategy:** `copyPixels(dst)` into a `Uint8Array`, then `new ImageData(...)` and `putImageData`.
3. **Zero-copy strategy:** `pixelsPtr()` then `new Uint8ClampedArray(go._inst.exports.mem.buffer, ptr, len)`, then
   `putImageData` straight from that view. Re-create the view on every frame (a `memory.grow` detaches old
   views); assert in the script that `view.byteLength === len` before use.
4. The one-way cost of sending 4 bytes/pixel from the page to the worker (`setImage` transfer).

Write the results to `docs/perf.md` as a table with the machine, OS, browser version, Go version and date.
**Decision rule (write it in the doc):** use zero-copy if it is at least 20% faster than copy at 8 MP *and* the
view check never failed over the run; otherwise copy. Implement the winner in `worker.ts`; keep the other behind
a flag (`?transfer=copy|view`) so it can be re-measured. Phone numbers come later (a human runs the bench page on
a phone and pastes the table into `perf.md`: **[HUMAN]**, optional).

**Tests.** The script exits non-zero if the view length check fails or a run produces a different hash than the
copy path (the two strategies must give identical pixels).

**Verify.** `node web/scripts/bench.mjs` prints the table and writes `docs/perf.md`. Commit the doc.

**Commit.** `Measure pixel transfer and record perf`

---

### P2-T07 · WASM equals native

**Goal.** The browser engine gives the same bytes as the native engine, for every golden recipe.

**Files.** `engine/testdata/golden/recipes.json` (generated), `web/scripts/wasm-golden.mjs`, a change to
`engine/golden_test.go`.

**Spec.** `golden_test.go` (phase 1) already has the recipe table; make `-update` also write
`recipes.json`: `[{name, w, h, gradientSeed, params, regions?: {cellSize, pattern, defs}, sha256}]` so another
program can rebuild each input. `wasm-golden.mjs` loads `build/engine.wasm` in Node (same loader code as
`scripts/wasm-hello.mjs`), reconstructs the `Gradient` image **with the same integer formula** (write it in JS
with `Math.imul`-free integer math; add a test), runs the recipe through the real WASM API (`init`, `setImage`,
`setRegions` where needed, `configure`, `prepare`, `instant`, `copyPixels`), hashes with `crypto.createHash('sha256')`
and compares to the file.

**Test first.** The script *is* the test. Run it before `cmd/wasm` has the full API: it must fail on the first
missing function.

**Also.** Make sure `make wasm-test` (the engine's own tests under WASM) passes including `TestGolden*` and
`TestSlopeTableGolden`; it needs `testdata` to be readable, which `go_js_wasm_exec` provides.

**Verify.** `make wasm && node web/scripts/wasm-golden.mjs` prints one `ok` line per recipe;
`make wasm-test` passes.

**Commit.** `Check WASM output against native goldens`

---

### P2-T08 · Browser smoke test and CI

**Goal.** An automated browser test that the lab really sorts, and CI that runs it.

**Files.** `web/e2e/lab.spec.ts`, additions to `.github/workflows/ci.yml`.

**Spec.** Test: open `/lab`; generate a 64x48 PNG in the test (a gradient with noise, built with a canvas inside
`page.evaluate`, then `page.setInputFiles` with a buffer); wait for the readout to show stats; assert the
"sorted" canvas is not identical to the "original" one (compare `getImageData` hashes), is a permutation of it
(sorted channel multisets equal), and that `crossOriginIsolated` is `true`. A second test sets angle to 90 and
mode `none` and checks every column of the sorted canvas is monotone by the chosen key. A third drops a text file
and expects the visible error.

CI: add a `web` job: checkout, setup-go, setup-node 22, `corepack enable`, `make wasm`, `pnpm --dir web install
--frozen-lockfile`, `pnpm --dir web check`, `pnpm --dir web lint`, `pnpm --dir web test`,
`pnpm --dir web exec playwright install --with-deps chromium`, `make e2e`.

**Verify.** `make e2e` passes locally.

**Commit.** `Add lab e2e test and web CI job`

---

### P2-T09 · Phase wrap-up

Run everything (`make check`, `make test`, `make wasm-test`, `node web/scripts/wasm-golden.mjs`, `make e2e`).
Tick `PROGRESS.md`. Put the headline numbers in `NOTES.md` for the reviewer ("8 MP instant sort: X ms; transfer
strategy: Y"). If any number is far worse than PLAN.md hoped (a pass over 2 MP above about 15 ms), say so
plainly in `NOTES.md`; do not hide it.

**Commit.** `Finish phase 2`
