# Decisions made while writing the dev plans

PLAN.md says *what* and mostly *why*. Turning it into buildable tasks forced some small choices. They are
listed here so nothing is hidden. **Where this file and PLAN.md differ, this file wins.** Every entry has a
reason; Autumn can overrule any of them (change the entry and the affected tasks).

Entries marked **verified** were prototyped and tested on arm64, amd64 and WASM under Node before being
written down (see `reference/`).

## Engine

**E1. Pixels are `[]uint32`, packed so the bytes in memory are R, G, B, A.**
`Pix[i] = r | g<<8 | b<<16 | a<<24`. (PLAN.md 3.1 said `[]uint8`.) Moving a whole pixel is one load and one
store, which is what the sorter does constantly, and on little-endian machines (arm64, amd64, WASM) the memory
is exactly what a browser's `ImageData` wants, so there is no conversion cost. `FromRGBA` and `RGBA()` convert
for tests and for the CLI.

**E2. Sort keys are `uint8`.** `intensity` is `(r+g+b)/3`, not `r+g+b` (PLAN.md 3.5), because 765 does not fit
a byte and one byte per key keeps memory down on a 50 MP image. Ordering differs from `r+g+b` only in how
near-ties are grouped. Formulas, all integer math, **verified** (see `reference/primitives.go.txt`):

| Key | Formula |
|---|---|
| `luma` | `(299r + 587g + 114b) / 1000` |
| `value` | `max(r,g,b)` |
| `intensity` | `(r+g+b) / 3` |
| `minimum` | `min(r,g,b)` |
| `saturation` | `max==0 ? 0 : (max-min)*255/max` |
| `hue` | integer sextant formula, result `0..254` |
| `red` `green` `blue` `alpha` | the channel |

`Reverse` flips a key to `255 - key`. Stability is preserved because equal keys stay equal.

**E3. Angles are whole degrees, 0 to 359.** `Params.Angle` is an `int`; values outside the range are rejected
by `Validate` (the UI wraps before sending). 0 sorts left to right; 90 bottom to top; 180 right to left; 270
top to bottom (PLAN.md P2). The major axis, direction and slope are chosen by integer rules, not by comparing
floats, so 45 and 135 degrees cannot flip on a rounding error. **Verified:** the partition is a bijection for
all 360 angles on ten image shapes including `1x1`, `1xN` and `Nx1`, with identical output on arm64, amd64 and
WASM.

**E4. Spatial parameters are per-mille of the image width.** `Length`, `Cell` and `WavePeriod` are integers
in thousandths of the width (PLAN.md 3.8: resolution independent). Pixels at a given size are
`max(1, (W*v + 500) / 1000)`, integer arithmetic. The UI shows pixels at the current working size and stores
per-mille. A preset written in pixels (the Python values) is converted with a reference width of **2000 px**:
`permille = round(px * 1000 / 2000)`.

**E5. Randomness is SplitMix64, one stream per line.** `NewStream(seed, lineID)`. `Seed` is a `uint32` so it
survives JSON in JavaScript. **Verified** known-answer vectors are in `reference/primitives_test.go.txt`.
`math/rand` is banned in `engine/` (its output may change between Go versions).

**E6. Integer-only geometry and decisions.** The wave modulation uses `Sin1000`, a parabolic integer sine, not
`math.Sin`. Feather and blends use integer rounding. The only float in the engine is the once-per-angle slope
computation, wrapped in explicit `float64()` conversions (stops arm64 fusing multiply-adds), and a golden
slope table is checked on every platform. Why: golden hashes must match on a developer's Mac, CI and the browser.

**E7. Interval rules (PLAN.md 3.3, made exact).**

- Intervals shorter than 2 pixels are not sorted.
- `random`: widths are `max(2, Uint32n(2*mean + 1))`, so the mean width is `mean` (not half of it, as in
  Python). `mean = max(3, lengthInPixels)`.
- `wave`: `factor = 1000 + WaveAmp*10*Sin1000(phase)/1000` (so `WaveAmp` 0 to 100, default 70, swings the
  factor between 300 and 1700), then `width = mean * factor / 1000 * (900 + Uint32n(201)) / 1000`, minimum 2.
  `phase = (pos * 65536 / periodPx + line * 11) & 0xFFFF`, where `pos` is the index along the line where this
  interval starts and `periodPx` is `WavePeriod` in pixels (default 6 x the mean width, at least 8).
- `randomness` (0 to 100): an interval is left unsorted when `Uint32n(10000) < randomness*100`. So 0 sorts every
  interval and 100 sorts none (PLAN.md fixed Python's off-by-one).
- `threshold`: pixels whose threshold-metric value is outside `[Lo, Hi]` (inclusive, 0 to 255) are **frozen**;
  each run of in-range pixels is one interval. The metric is `ThresholdKey` (default `luma`).
- `edges`: edge map = 3x3 Laplacian on luma, `8*centre - sum(8 neighbours)`, edge pixels clamped to the border
  by replication, absolute value clamped to 255; a pixel is an edge when the value is greater than `Edge`
  (0 to 255). Cut at the first pixel (in walking order) of each run of edge pixels.
- `none`: one interval per line (or per run between frozen pixels).
- `ca`, `ca-edges`: phase 4.

**E8. The instant sorter is a stable counting sort** (keys are bytes), with insertion sort for intervals under
32 pixels. A property test compares it with `sort.SliceStable` as an oracle.

**E9. The stepper** (phase 3) advances in passes. Odd-even transposition (swap only when `key[a] > key[b]`),
insertion (one element per pass) and bottom-up merge (take from the left on ties) are all stable. `Reveal` is not
a sort: it finishes whole intervals a chunk at a time. Different regions may use different algorithms at once
(the mockup does this; keep it). Done when every family is done.

**E10. Regions are plumbing from day one.** `Plan` takes an optional `*Regions` (labels, class of cell, class
definitions) and an optional frozen `Mask`. Phase 1 builds and tests that plumbing with hand-made label maps;
phase 7 adds the tessellations, polygon fill and the UI. Class 0 (the gaps between shapes) is frozen by the
shape builder, not by the engine, which treats `Defs[class].Frozen` literally.

**E11. Feather** is two passes of an integer box blur over the mask (radius in pixels), giving alpha 0 to 255,
then `out = Lerp255(sorted, original, alpha)` per channel. The mask itself stays a hard barrier for sorting.

**E12. `EngineVersion` is a string constant, starting at `"1"`.** Bump it in the same commit that deliberately
changes a golden. It is stored with every run.

## Boundary between JavaScript and the engine

**B1.** One coarse API (PLAN.md 5): `init(w,h)`, `setImage(rgba)`, `setRegions(...)`, `configure(json)`,
`prepare()`, `step(n) -> done`, `finishInstant()`, `pixels()`. Parameters cross as JSON, pixels as typed arrays.
Region labels cross as a `Uint16Array`, class table as a `Uint8Array`, class definitions as JSON.

**B2.** The browser decodes and encodes images (`createImageBitmap`, `canvas.toBlob`); the engine only ever
sees raw RGBA. The server never decodes pixels.

**B3.** One worker in version 1; no dependence on `SharedArrayBuffer`. The server still sends COOP and COEP so a
worker pool can be added later without a deployment change.

## Web

**W1.** SvelteKit with `adapter-static`, Svelte 5 runes, TypeScript strict, pnpm. The Go server embeds
`web/build` with `go:embed`.

**W2.** Fonts (Instrument Serif, DM Mono) and icons are **vendored**, not loaded from Google. The mockups
use Google Fonts for convenience; the real app must work offline and its tests must not need the network.

**W3.** The pure mockup modules are ported to TypeScript one-to-one (names kept), each with a Vitest file
holding the same assertions as its mockup test. The mockup-only machinery is **not** ported: URL switches
(`?used=`, `?error=`, `?update=`, `?runs=`), "mockup only" chips, `localStorage` as a database, the fake link
triggers (`blocked`, `huge`, ...). Real equivalents come from the server.

**W4.** Names, settings and presets are stored on the server (phase 6) once it exists; until then the app
uses `localStorage` behind a small storage interface, so swapping is one file.

## Server

**S1.** `modernc.org/sqlite`, WAL mode, forward-only migrations as embedded `.sql` files and a
`schema_migrations` table. Snapshots use `VACUUM INTO`.

**S2.** Run ids are integers; share ids are 128 random bits, base32. Image files are content-addressed
(SHA-256) under `data/images/ab/abcdef....ext`.

**S3.** Errors from the API are JSON `{ "error": { "code": "...", "message": "..." } }` with a stable code
catalog mirroring the web error catalog.

**S4.** The version string is `r<commit count>.<short sha>`, stamped at build time with
`-ldflags "-X .../version.Version=..."`, and served by `/healthz`.

## Saving and delivery (issue sweep, 2026-11-06)

**V1. Saving is explicit (replaces D8's "auto-save every run").** A run is stored when the person presses Save, or
exports. The setting `autoSave` (default off) restores the old rule: 2 s after a sort settles, when an animation
finishes, and on export. The bundled demo photo is never stored by itself. Pressing Save when nothing changed since
the last save sends nothing. Leaving with an unsaved look warns once and never blocks twice.

**V2. The engine download is compressed and revalidated, not versioned.** `engine.wasm` (and other text assets) are
gzipped when the client accepts it, with `Vary: Accept-Encoding` and a different strong ETag per encoding. Everything
that is not a hashed asset is `Cache-Control: no-cache`: the browser keeps it but asks first, and a repeat visit is a
304. A versioned URL was rejected as more to get wrong. There is no brotli (not in the Go standard library).

**V3. The page, not the worker, owns recovery from a failed download.** The worker retries once and reports; the page
shows "didn't finish downloading" and "Try again" starts a fresh worker and puts the same picture back.

**V4. A run stores the whole look, inside its free-form `settings`.** The sort params stay at the top level exactly as before
(so old runs and the server's duplicate check on a plain sort are unchanged); a look with cells adds `regions: {tiling, cards}`
and one with protected areas adds `mask: {objects, strokes, invert, feather}`. No migration. Reading a run back validates and
clamps everything (`run-recipe.ts`): old runs open as just their knobs. The server's meta limit went from 256 KiB to 1 MiB
because every brush stroke is stored.

**V5. Opening a run never changes it.** "Open in Studio" loads the stored original and the whole look and sets the parent;
the next save is a new run with `parent_run_id` set, and later saves in the session chain from the previous one. A run made by
another engine version opens with a note, and still branches.

## Process

**P1.** One branch per phase (`build/phase-N`), one commit per task, no pushing by the build agent. Review
happens on the diff against `main`.

**P2.** Open questions the agent hits are answered by choosing the simplest consistent option and logging it in
`NOTES.md`, not by stopping.

**P3.** Cloudflare account, domain and homelab steps are marked **[HUMAN]** and skipped by the agent. The code
for them is written against environment variables so the human step is only "set these".
