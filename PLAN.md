# pixelsort-go — Plan

A from-scratch pixel sorter: a Go engine compiled to **WebAssembly** so it runs *in the browser*, a
**SvelteKit** front end built around watching the sort happen live, and a tiny Go server on the homelab
that serves the app and keeps a **gallery** of every run.

**Status:** 🚧 Planning only. No code, no repo history yet. Most open questions are settled — see §11.
**Predecessor:** [`Pixelsorting`](../Pixelsorting) (Python + Gradio). That repo stays untouched as a
historical archive of Autumn's early work. This one is a green field.
**Written:** 2026-11-02, after reading every Python source file in the predecessor (audit in Appendix A).

Credit where it is due: the algorithms descend from [satyarth/pixelsort](https://github.com/satyarth/pixelsort),
which itself descends from Kim Asendorf's original ASDF Pixel Sort Processing script (the "Kims" preset).
Both are open source (checked 2026-11-02: `satyarth/pixelsort` is MIT); this project is a from-scratch rewrite, credits them in the README, and is MIT too.

---

## 1. Goals

1. **Watch the sort itself, live.** Pixels visibly moving into place on a canvas, at a speed she controls.
   This is the headline feature and the reason for the whole architecture.
2. **Instant live preview.** Dragging any slider re-sorts a working-resolution copy fast enough to feel
   like a filter, not a job.
3. **Everything runs on the device that loads the page.** The homelab box (Le Potato, quad Cortex-A53,
   ~2 GB) is compute-bound by nature; it serves files and stores results, nothing more.
4. **A real gallery.** Every run is saved automatically — original, result, settings, seed — and can be
   reopened, tweaked, branched, downloaded.
5. **Finish the shapes/drawing project** that was planned in the Python repo and never built: draw masks,
   auto-complete shapes, segment the image into geometric regions.
6. **A frontend she actually likes.** Gradio was a step; this is the destination. (Design direction is a
   separate conversation — see §10.)
7. First project in the homelab to use **compiled WASM as a target**.
8. **Share a selection as a link.** Pick runs in the gallery → "Upload to a gallery" → one unlisted URL
   anyone can view and download from (§6b). Replaces what put.re did for the Python project.
9. **Load images from a URL**, so nothing has to be downloaded and re-uploaded by hand (§6b).
10. **Bulk-delete** from the gallery, with a trash and an undo window (§6).

### Non-goals

- Not a port of every Python feature (see §4 "Not porting").
- No accounts, no auth. The app itself is tailnet-only, like every other service on the box. The *only*
  public surface is the share Worker, and it serves only albums Autumn explicitly uploads (§6b).
- No server-side image processing. The server never touches pixels.
- Not a byte-for-byte reproduction of the Python output. We are improving the algorithms (§3).

---

## 2. Architecture

```
Browser (does all the work)                         Potato (dumb and cheap)
───────────────────────────────────                 ──────────────────────────────
SvelteKit UI (adapter-static)                       Go binary, SvelteKit build via go:embed
  ├─ <canvas> stage + drawing layer                   ├─ static files (+ COOP/COEP headers)
  └─ Web Worker                                       ├─ Gallery API  /api/runs, /api/images
       └─ engine.wasm  (Go, GOOS=js GOARCH=wasm)      ├─ SQLite (modernc, no CGO) + files on disk
            ├─ lines / intervals / regions / keys     └─ /healthz  → Meridian tile
            ├─ instant sorter
            └─ stepper (animation)
```

### Why this shape

- **Pixels never leave the browser** except as finished, encoded files for the gallery. The server can
  be tiny, and a 2 GB board is fine.
- **One engine, three consumers.** The engine is a pure Go package (no I/O, no globals, no `syscall/js`).
  It is imported by the WASM entry point, by native `go test`, and by a possible CLI later.
- **The worker owns the pixels.** Ideally it draws to an `OffscreenCanvas` itself so the main thread
  (and the UI) never stalls while a frame is computed.

### Repo layout (proposed)

```
pixelsort-go/
├── PLAN.md  README.md  LICENSE  CLAUDE.md
├── go.mod                       # module github.com/AutumnsGrove/pixelsort-go
├── engine/                      # pure Go, heavily tested, no I/O
│   ├── image.go                 # flat RGBA buffer type
│   ├── params.go                # Params + validation + JSON
│   ├── lines.go                 # scanline partition (§3.2)
│   ├── regions.go               # label map, frozen/barrier semantics (§3.4)
│   ├── intervals/               # random, wave, threshold, edges, none, ca
│   ├── keys.go                  # sort keys
│   ├── ca.go                    # elementary cellular automata
│   ├── sorter.go                # instant sort
│   ├── stepper/                 # animated algorithms (§3.5)
│   ├── shapes/                  # tessellations + polygon fill (§3.4)
│   └── version.go               # EngineVersion const
├── cmd/
│   ├── wasm/main.go             # syscall/js bindings, build tag js,wasm
│   └── pixelsort-go/            # cobra: serve, (later) render
├── server/                      # gallery API, storage, trash, share + fetch relay, embed
├── worker/                      # Cloudflare Worker (share viewer, album store, /fetch) — wrangler project
├── web/                         # SvelteKit app
├── deploy/                      # Dockerfile, compose, update.path/.service, .env.example
├── docs/
└── Makefile                     # wasm build, web build, test, run
```

Same conventions as `bwmon` and `Cairn`: cobra CLI, `go:embed` of an adapter-static build (no Node at
runtime), pure-Go SQLite so there is no CGO and cross-compiling from the Mac works.

---

## 3. The engine

### 3.1 Data model

- **Image:** one flat `[]uint8` RGBA buffer, `width`, `height`. (The Python used a list of lists of
  4-tuples; that, not the interpreter alone, is most of why it was slow.)
- **Keys:** a per-pixel sort key computed once into a small array (`uint8`/`uint16`, not float), so a
  50 MP image does not need 200 MB of keys on top of 200 MB of pixels.
- **Params:** one JSON-serializable struct. It is the *recipe*: stored with every run, and (with the
  seed and `EngineVersion`) enough to reproduce a result exactly.
- **Determinism:** every random decision comes from a PRNG seeded by `(seed, lineID)` — never a global
  RNG. Same recipe → same image, regardless of worker count or scheduling. Dragging a slider must not
  re-roll the dice.

### 3.2 Sorting along any angle without rotating the image

The Python rotates the image (nearest-neighbour, `expand=True`), sorts rows, rotates back and crops.
That is lossy, produces transparent corners that get sorted as real pixels, and the rounding may
differ by a pixel from any other implementation. We do not rotate.

**Line partition.** For a sort angle θ with `|tan θ| ≤ 1`, give every pixel `(x, y)` a line id

```
k = y − round(x · tan θ)
```

Each pixel gets exactly one `k`, so the lines tile the image with no gaps and no overlaps; each line is
a staircase of pixels walked in `x` order. For steeper angles swap the roles of `x` and `y`. 90° is
columns, 180° is rows walked in reverse, and so on. Lines have different lengths because they are
clipped by the image edges — that is fine.

- The sort is therefore a **pure permutation** of the original pixels. That makes "the animation's
  final frame equals the instant result" provable, and makes the property tests cheap.
- Per-pixel analyses (threshold, edge map, CA mask, region labels) are computed on the **original**
  image and read *along* each line. No rotated copies.
- The angle convention (which way is 0°, CW vs CCW) is decided in Phase 1 and must match the UI's angle
  dial exactly.

### 3.3 Intervals

A line is cut into **intervals**; each interval is sorted independently. Two primitives, because the
Python conflated them:

- **cut** — start a new interval here; the pixel still participates in sorting.
- **freeze** — this pixel does not move and splits the interval around it (a barrier).

| Mode | Primitive | Notes |
|---|---|---|
| `random` | cut | `length` is now the **mean** interval length. (Python's was uniform `0..clength`, i.e. mean `clength/2` — the slider lied.) |
| `wave` | cut | Python's "waves" was just `clength + randint(0,10)`. Make it real: a sine/noise-modulated length, with amplitude and period parameters. |
| `threshold` | **freeze** | Pixels outside `[bottom, top]` are frozen barriers; runs of in-range pixels are sorted. This is what Kim Asendorf's original does. Python instead started a new interval *at* the out-of-range pixel and sorted it with the next run, moving it. Intentional behavior change. |
| `edges` | cut | Edge map from a 3×3 Laplacian (`−1 … 8 … −1`, same kernel as PIL's `FIND_EDGES`), thresholded; cut at the leftmost pixel of each run of edge pixels. |
| `none` | — | One interval per line. |
| `ca` | cut | Cellular-automaton mask (§3.6) — Python's `file`. |
| `ca-edges` | cut | Edges of the CA mask — Python's `file-edges`. |
| `regions` | freeze/cut | From the region map (§3.4). Composes with any mode above. |

Other fixes baked in:

- **Per-interval skip uses a float compare** `rand < 1 − randomness/100`, not `randint(0,100) >= r`
  (which had 101 outcomes, so `randomness=100` still sorted ~1% of intervals).
- **Threshold metric is selectable** (default luma). Python always thresholded on HSV value regardless
  of the sort key.
- **Sort direction toggle** (ascending/descending). Python had none.
- Edge cleanup (keep the leftmost of a run) is specified explicitly instead of falling out of an
  order-dependent in-place right-to-left loop that also skipped the first two rows and columns.

### 3.4 Regions — one concept for masks *and* segmentation

The old shapes-and-drawing plan had two features with separate machinery: mask exclusion (draw areas to
protect) and geometric segmentation (cut the image into shapes, sort each as its own job, reassemble
with blend modes). Both become **one idea**:

> A **region map** assigns every pixel a region id. Intervals never cross region boundaries. Each region
> has settings: *frozen*, or *sort* with optional overrides (angle, key, interval mode, length, …).

- **Mask drawing** = region 0 is `frozen`. Masked pixels are barriers and are guaranteed untouched
  (a property test, not a hope). An "invert" toggle swaps frozen/sort.
- **Soft masks (feather)** = a per-pixel alpha applied as a final blend `lerp(original, sorted, alpha)`.
  Hard masks are barriers; soft masks are a blend. Both exist; they are different tools.
- **Segmentation** = the region map comes from a tessellation (grid, hex, triangle, diamond, n-gons,
  stars, Voronoi, custom SVG). Each segment can carry its own angle/key/etc.
- **No reassembly step.** Everything happens in one pass over one buffer, so there are no seams and the
  planned "blend modes for reassembly" become an optional post-effect, not a requirement. Segments are
  independent, so they parallelize and animate simultaneously on one canvas.

**Resolution independence.** Shapes and masks are stored as *vector descriptions* in normalized
coordinates (0–1), not as pixels. They are rasterized at whatever resolution is needed (preview or full
export), so the preview and the export agree.

**Where rasterizing happens.** Tessellations and polygons are filled in the **Go engine** with a plain
scanline polygon fill (deterministic, testable, no anti-aliasing). Do *not* paint labels with Canvas 2D:
canvas fills are anti-aliased and cannot be turned off, so edge pixels blend two region ids into a third,
bogus one. Freehand mask strokes *are* drawn on a canvas — they are alpha, soft by nature — then
thresholded at 50% for the hard mask or kept as the feather alpha.

**Region API shape (validated in `mockups/shared/demo-engine.js`).** A region map is three things:

- `labels` — one **cell id** per pixel (`uint16`); `0` means "between shapes".
- `classOfCell` — maps each cell to a **class** (`uint8`). Patterns (all alike / checker / thirds / random)
  are just ways of assigning classes to cells.
- `defs[class]` — per-class overrides: `frozen`, `angle`, `sortKey` (each optional).

Intervals never cross a cell boundary. A class with its own angle is walked on *that* angle's line
partition, then each line is cut wherever the cell changes or a pixel of another class interrupts it —
so the one-pass, one-buffer design holds and every pixel is still in exactly one line. Class 0 (the gaps)
is **frozen by default**, because unfrozen gaps sort along whole rows and leave thin glitch lines along
the seams. **Feather** is a blend, not a barrier: masked pixels stay hard barriers for sorting, and the
output near the mask edge is `lerp(sorted, original, blurredMask)`.

Tilings in the mockup: square, hexagon, triangle, diamond, circle, octagon, Voronoi (SVG upload, stars and
pentagons from the old plan come later). The mockup tests, over 56 combinations of shape × pattern ×
image size with frozen / re-angled / re-keyed classes: full line coverage with no duplicates, output is a
pure permutation, frozen pixels never move, no interval crosses a cell, and stepper == instant. Port
these as the engine's region tests.

**Masks are objects, not stamps (mocked and tested).** A mask is a freehand **brush layer** plus any number of
**shape objects**, then an optional **invert**, then **feather**. Each object is `{kind: ellipse | rect | polygon,
cx, cy, w, h, rot, mode: add | cut}` with centre and size stored as *fractions of the picture* and rotation in
degrees, so a preview and a full-resolution export agree; objects are rasterised on demand, in order — `add`
freezes pixels, `cut` punches a hole. Objects can be moved, resized (corner handles; Shift keeps proportions),
turned (rotate handle; Shift snaps to 15°), nudged with arrow keys, typed exactly into number fields, duplicated
and deleted; the active shape is edited on the picture itself with SVG handles that stay crisp at any zoom.
Other rules the mockup settled:

- **Invert is a toggle**, never a destructive bake, so it can be undone.
- **Snap makes real objects.** Looping a brush stroke around something offers “Looks like a circle · Snap”
  (closed-loop test + ellipse / rectangle fit, no OpenCV); accepting it *replaces the stroke* with an editable
  shape — it never doubles up.
- **“Freeze the brightest spot”** drops an editable ellipse on the blob of brightest pixels in *the user's own
  picture* (top 1.5% by luma, centroid + √(area/π)) instead of a canned position.
- Brush strokes stay raster at working resolution in the mock; in the real app they are stored as vector
  strokes so they too re-rasterise at export size.
- Tested end-to-end with real pointer input (18 checks): add, drag, resize, rotate by handle and by number,
  exact size, hole, invert, Delete key, remove-all, brightest-spot then drag, loop → snap → editable.

**Per-region cutting (mocked and tested).** Each class may override, besides `frozen`, `angle` and
`sortKey`: the sort **direction** (asc / desc) and the whole **cutting recipe** — `mode` plus that mode's own
parameters (`length`, band `lo`/`hi`, `edge` sensitivity, CA `rule` + `cell`) and `randomness`. Anything unset
inherits the global setting. Because a run never leaves its cell, every run belongs to exactly one class, so
its recipe is unambiguous. Tests (32 configs: 8 shapes × grid/staggered × 2 patterns, classes using threshold /
cellular / wave at different angles with reversed keys): full coverage, pure permutation, frozen untouched,
no cell crossed, each interval sorted by *its class's* key, stepper == instant.

**Custom shapes (SVG).** A custom shape is just a polygon in the unit square, tiled on a grid (optionally
staggered like brickwork) with the same gap / size / turn controls as the built-ins.

- The **browser** turns SVG into a polygon: parse with `DOMParser`, pick the longest outline among
  `path / polygon / polyline / circle / ellipse / rect`, sample it with the geometry API
  (`getTotalLength` / `getPointAtLength`), normalise to the unit square. The SVG is **never injected into the
  page** — it is parsed as data and discarded, so uploaded SVGs cannot run script.
- The **engine** only ever receives a polygon (`[[x,y],…]`) and fills it with its normal scanline fill.
- Eight starter shapes ship built in (star, heart, drop, bolt, moon, leaf, cross, arrow). User shapes live in the
  gallery database (the mockup uses `localStorage`) and are listed under *Your shapes*.
- Dropping an `.svg` **anywhere** in Studio adds it as a shape rather than loading it as the picture.
- **Mock limits to lift in the real build:** only the first sub-path is used (holes are ignored),
  element `transform`s are ignored, and there is no outline cleanup/simplify step.

**Shape auto-complete** (from the old plan): done in the browser in TypeScript, no OpenCV. Resample the
stroke, test closure, fit a circle/ellipse by least squares, run Ramer–Douglas–Peucker to count corners
(3 → triangle, 4 → rectangle/diamond, 5/6/8 → pentagon/hexagon/octagon). It *suggests* ("snap to
hexagon?") instead of forcing, with a one-tap accept. Undo works on strokes (vector), not pixels.

**Custom SVG shapes:** parse the path in the browser, flatten to a polygon, hand vertices to the engine.

### 3.5 Sort keys

| Key | Notes |
|---|---|
| `luma` | **New.** Perceptual brightness (`0.299R + 0.587G + 0.114B` or Rec.709). Python had no real brightness sort. |
| `value` | `max(r,g,b)`. This is what Python called `lightness` (HSV value) — and is identical in ordering to Python's `maximum`, so the two collapse into one. |
| `intensity` | `r + g + b` |
| `hue`, `saturation` | Integer HSV math; keys quantized to 8 or 16 bits. |
| `minimum` | `min(r,g,b)` |
| `red`, `green`, `blue`, `alpha` | Channels |

Ties are common in 8-bit images, so **sorts must be stable** (Python's `sorted` is, and the streaky look
depends on it).

### 3.6 Cellular automata (must-have)

Elementary 1-D CAs (Wolfram rules 0–255) used as interval masks.

- Standard Wolfram rule encoding; seeded random first row; **deterministic** with the seed.
- Keep the curated list of "interesting" rules from the Python
  (`26, 19, 23, 25, 35, 106, 11, 110, 45, 41, 105, 54, 3, 15, 9, 154, 142`) as the "random" pool and the
  rule picker's suggestions, with the same one-line character notes.
- **Cell size is a parameter.** Python hard-coded cells of 4 px (8 px above 2500 px) and scaled up with
  **Lanczos**, then compared pixels to *exact* black. Lanczos on a binary image makes grey ringing, so
  only each block's core was ever "exactly black" — an accident, not a design. We use nearest-neighbour
  expansion with an explicit cell size, so cell width/height are real controls.
- Python's edge cells were random each generation; we make the boundary behavior a choice
  (random / wrap / fixed).
- **Open:** the mask lives in image space and is read along the sort lines, so at non-zero angles the
  pattern is sheared. Alternative: generate it in line space so the pattern rotates with the sort. Try
  both in Phase 1; keep whichever looks better, or offer both.
- Related prior art on this machine: `~/Documents/Projects/ElementaryCAVisualizer` (a p5.js CA
  visualizer by Autumn). Worth reading for rendering ideas and its rule notes before writing `ca.go`.

### 3.7 Animated sorting — the headline feature

The instant sorter and the animation share the same lines, intervals, regions and keys. They differ only
in *how* each interval gets sorted:

- **Instant:** sort each interval in one call.
- **Stepper:** advance a visible algorithm by N steps per frame, in place, on the same buffer. The
  frame the canvas shows *is* the live buffer.

**Only stable algorithms are allowed**, so the final frame is pixel-identical to the instant result
(this is a test: stepper-to-completion == instant, for every algorithm, mode and angle).

| Algorithm | What you see | Notes |
|---|---|---|
| **Odd-even transposition** | Pixels ripple into place in synchronized waves | One pass over everything per step; the most uniform. Needs up to *n* passes for the longest interval. |
| **Insertion** | The classic streak: each pixel slides back until it fits | Most recognizable; slows on long intervals. |
| **Bottom-up merge** | Chunky blocks that merge, ~log₂ n passes | Fastest to finish; glitchiest. |
| **Reveal** *(not an algorithm)* | Lines are completed top-to-bottom (or in scan order) | The cheap "progressive" live mode; trivially the same machinery. |

Shell sort and quicksort are out: they are not stable.

**Live modes, to be explicit about the three of them:**
1. **Live preview** — every control change re-sorts instantly (debounced, cancels the in-flight job).
2. **Animate** — the stepper, with speed (steps/frame, or auto-fit to ~16 ms), pause/play, restart.
3. **Reveal** — progressive line-by-line.

Longest interval drives frame count: `clength 50` finishes in a handful of frames; `threshold` on a wide
image can have intervals spanning a whole row (~2000 passes for odd-even). Hence the speed control. A
pass over a ~1080p working copy (~2 M pixels) is *estimated* at a few ms in WASM; **measure this in the
Phase 2 spike** before promising 60 fps.

**Scrubbing/rewind** (later): deterministic replay — reset and run N passes — rather than storing a
full-resolution checkpoint per frame (8 MB each at 1080p).

### 3.8 Resolution, units, and the "scale" slider

The Python's *Image Scale %* slider existed because params were in pixels: scaling the image changed the
look, so scaling down gave "more visible effects" by accident of units.

New rule: **all spatial params are resolution-independent** (stored as a fraction of image width; the UI
shows pixels at the current working size). Then:

- *Working resolution* (for speed) is separate from *the look*, and the final full-res export matches the
  preview in character (not pixel-for-pixel — random intervals differ at a different pixel grid).
- Animation and live preview run on a working copy (default ≤ ~1080p, lower on phones).
- Export re-runs the instant sorter on the full-res image with the same recipe and seed.
- "Smaller image, chunkier effect" becomes an explicit *Detail/Coarseness* control rather than a side
  effect.

**Memory ceiling is real.** 50 MP RGBA is 200 MB, plus keys, plus the output copy. Desktop probably
works; a phone probably will not. Plan: cap working resolution by device, process full-res export in line
bands, and be honest in the UI when an image is too large for the device.

---

## 4. Feature scope

### Porting (and improving)

- Interval modes: random, wave, threshold, edges, none, ca, ca-edges (§3.3)
- All sort keys (§3.5) + luma + direction
- Angle (scanline partition, §3.2), randomness, length, thresholds
- **Cellular automata** (§3.6)
- **Masks, drawing, shape auto-complete, segmentation** (§3.4)
- **Presets**: the 8 built-ins become data, plus user presets stored on the server (not in a dotfile).
  Built-ins: Main, File, Random, Kims, Gentle, Intense, Waves, Edges. Presets can include *ranges*, and
  "randomize within range" happens when the preset is **applied** (Python rolled the dice once at import,
  so "Main" was the same every click until restart).
- **Nice UI ideas from the Gradio app worth keeping:**
  - live **threshold overlay** ("focus peaking" showing which pixels will be sorted) — trivial on a canvas
  - angle dial, threshold bar, sort-key gradient preview, CA preview
  - example images
- **Download** results; **auto-saved gallery** (§6)
- **URL loading** (via the Cloudflare Worker, §6b) alongside upload, drag-drop and paste
- **Share links** for albums of results (§6b)

### Not porting

- **Snap** ("Thanos snap") — a meme, per Autumn.
- **shuffle-total / shuffle-axis** — her first attempt at her own sorting algorithm; didn't turn out well.
- Gradio, `ProgressManager`, tqdm, the CLI.
- `crop_to_reference`, `dbpreset`/`filelink`, and every unused `AdvancedConfig` flag
  (`parallel_processing`, `save_intermediate`, `enable_*`, …).
- Pixel-for-pixel Python compatibility.

### Later / stretch

Algorithm picker polish, scrubbing, video recording of the animation
(`canvas.captureStream()` + `MediaRecorder` → WebM, saved to the gallery), worker-pool parallelism,
multiple mask layers (soft/hard/invert), mask morphology (erode/dilate), content-adaptive segmentation,
batch processing, project import/export file, shareable recipe links.

---

## 5. WASM specifics

- **Standard Go** (`GOOS=js GOARCH=wasm`), not TinyGo, to start. Expect a ~2–3 MB binary (~1 MB gzip) —
  fine on a tailnet. Revisit TinyGo only if load time or speed disappoints.
- **Go's WASM is single-threaded.** Goroutines work but share one thread. Real parallelism = a pool of
  Web Workers, each with its own module instance, each owning a band of lines. Sharing one image buffer
  between them needs `SharedArrayBuffer`, which needs **cross-origin isolation** (`COOP` + `COEP`
  headers) *and* a secure context.
- **Therefore serve over HTTPS** (`tailscale serve`, like Polaris/Meridian). Plain `http://100.x.x.x`
  is not a secure context: no `SharedArrayBuffer`, and no `crypto.subtle` for hashing uploads. Verify
  the COOP/COEP headers survive `tailscale serve` in Phase 0.
- **Getting pixels to the canvas.** Cheapest is exposing the buffer's address and viewing WASM linear
  memory directly from JS (zero copy). Fallback is `syscall/js.CopyBytesToJS` each frame (a few ms at
  1080p). Caveats: a view must be re-created if `memory.grow` detaches it, and the buffer must stay
  referenced on the Go side. Decide in the Phase 2 spike by measuring both.
- **Coarse API across the boundary** (calls are not free): `init(w,h)`, `setImage`, `configure(json)`,
  `prepare()`, `step(n) → done`, `finishInstant()`, `pixels()`. Never one call per pixel.
- Cancellation: a monotonically increasing job id checked between passes; newer config supersedes.

---

## 6. Gallery and server

### What a run is

`{ original, result, thumbnail, settings JSON (incl. seed), engine_version, timestamps, parent_run_id }`.
Because the recipe is deterministic, any run is reproducible; the stored result is a convenience (and a
guarantee if the engine ever changes — which is why `engine_version` is recorded).

### Schema (sketch)

```
images(id, sha256 UNIQUE, kind[original|result|thumb|video], mime, width, height, bytes, created_at)
runs(id, created_at, original_id, result_id, thumb_id, video_id NULL,
     settings_json, seed, engine_version, duration_ms, parent_run_id NULL,
     source_url NULL,               -- provenance when loaded from a URL (the URL may rot; the bytes are kept)
     starred, title NULL, notes NULL,
     trashed_at NULL)               -- soft delete, see "Trash" below
tags(run_id, tag)
presets(id, name UNIQUE, description, settings_json, built_in, created_at)
shares(id, share_id UNIQUE, revoke_token, created_at, expires_at NULL, include_recipe, include_original)
share_items(share_id, run_id, position)
```

Files live under `data/images/ab/abcdef….<ext>`; SQLite holds metadata only. Originals are stored as
uploaded (no re-encode) and deduplicated by SHA-256, so ten runs on one photo store one original.

### API (all JSON unless noted; no auth, tailnet only)

| | |
|---|---|
| `POST /api/images/check` | `{sha256}` → `{exists}` so the client skips re-uploading an original |
| `POST /api/runs` | multipart: settings JSON + any missing blobs → run id |
| `GET /api/runs?cursor=` | paginated list for the gallery |
| `GET /api/runs/{id}` | full run incl. settings |
| `PATCH /api/runs/{id}` | star, title, notes, tags |
| `POST /api/runs/trash` | `{ids:[…]}` or `{filter:{…}}` → move runs to the trash (soft delete) |
| `POST /api/runs/restore` | `{ids:[…]}` → bring runs back from the trash |
| `POST /api/trash/empty` | permanently delete everything in the trash now; garbage-collect unreferenced images |
| `GET /api/usage` | `{used_bytes, budget_bytes, trash_bytes, runs}` for the gallery meter and Meridian |
| `POST /api/fetch` | `{url}` → image bytes, relayed through the share Worker (§6b) |
| `POST /api/shares` | `{run_ids, include_recipe, include_original, expires?}` → `{url, revoke_token}` |
| `DELETE /api/shares/{id}` | revoke: deletes the album from the Worker/R2 |
| `GET /api/images/{sha256}` | serve a blob (long-cache, content-addressed) |
| `GET/POST/DELETE /api/presets` | user presets |
| `GET /healthz` | `{"status":"ok","version":"…"}` — cheap, for Meridian |

### Behavior

- **Auto-save every run**, with delete controls. (Decided.) The browser encodes the result (lossless:
  PNG/WebP) and uploads it; the server never decodes pixels.
- Reopen a run → controls restore, canvas shows the result; **branch** from a run to try variations
  (`parent_run_id`).
- **Disk budget: 50 GB** (decided). A 12 MP lossless result is easily 20–30 MB, so this is roughly a
  couple of thousand large runs — plenty, but it needs a meter. Lossless WebP helps; and any run can be
  *regenerated* from its recipe if ever needed.
  - The gallery shows a **usage meter**; it **warns at 80%**. At 100% new runs still save, but the
    warning is loud. **Nothing is ever auto-deleted.**
  - `GET /api/usage` also feeds a Meridian vital.
- **Bulk delete + Trash** (decided):
  - Multi-select in the gallery, plus smart selectors: *older than…*, *by tag*, *unstarred only*,
    *largest first*, *runs with no children (not branched from)*.
  - **Starred runs are excluded from "select all"** and need an explicit second confirmation to trash.
  - Deleting moves runs to the **Trash** (`trashed_at`); the trash is emptied automatically after
    **7 days**, or immediately with "Empty trash now". Space is only freed when the trash empties, so the
    meter shows trash size separately and "Empty trash" is one tap away from the delete flow.
  - Deleting a run that is the *parent* of others re-parents the children rather than orphaning them.
  - A run that is part of a **live share** warns first (the shared copy lives in R2 independently; trashing
    locally does not revoke it — revoke is its own action).
- **Backup:** not everything needs R2 (decided). Recipes + settings are tiny, so back those up (and the
  presets table); the images are treated as regenerable/disposable unless starred. A nightly `rclone`
  of the SQLite DB and starred results to the existing R2 remote is the suggested minimum; revisit when
  deploying (Phase 8).

---

## 6b. Share links and URL loading — one Cloudflare Worker

The only thing in this project that lives outside the homelab. One small Worker (working name
`pixelsort-share`) with one R2 bucket (its own, **not** the existing backup remote), doing two jobs.

```
                              ┌──────────────────────────── Cloudflare ───────────────────────────┐
Browser ──► Potato (secret) ──►  Worker  ──┬─ PUT /api/albums/…       → R2  (share)                 │
   │                          │            ├─ GET /fetch?url=…        → public internet (URL load)  │
   │                          │            └─ GET /a/{id}[/n]         ← anyone with the link        │
   └── direct GET (CORS *) ◄──────────────────────────────────────────  (shared images, viewer)     │
                              └────────────────────────────────────────────────────────────────────┘
```

**Rule: the Cloudflare secret lives only on the potato.** The browser never holds it. Uploads and URL
fetches are relayed by the potato, so the Worker can reject anything that isn't signed with the shared
secret — which also means it is not an open public proxy.

### Share links ("Upload to a gallery")

1. In the gallery, select runs → **Upload to a gallery** → choose what to include:
   - result images (always)
   - **the recipe** (settings JSON) — opt-in, so viewers can reproduce it
   - **the original** — opt-in, off by default
   - optional expiry (never / 30 days / custom)
2. The potato reads the files from its own disk and pushes them to the Worker (the browser is not
   involved in the transfer), then stores a `shares` row with the link and a **revoke token**.
3. The Worker stores `albums/{id}/manifest.json`, the images and thumbnails in R2, and serves:

| Route | Does |
|---|---|
| `GET /a/{id}` | Minimal viewer page: grid, zoom/inspect, download buttons, optional "copy recipe". **No sorting.** |
| `GET /a/{id}/{n}` / `/a/{id}/{n}/thumb` | The image / thumbnail, with `Access-Control-Allow-Origin: *`. |
| `GET /a/{id}/manifest.json` | Image URLs, dimensions, and (if included) the recipes. |
| `PUT /api/albums/{id}/…`, `DELETE /api/albums/{id}` | Upload / revoke. Secret required. |

- **Unlisted, not private:** IDs are long random strings; there is no index or search. Anyone holding
  the link can see it. Say so in the UI.
- **Open loop:** because shared images are served with CORS, *any* copy of the app (including one a
  friend runs from the repo) can load a share link by URL with no proxy at all — "download the project,
  fetch the image URL" works. Recipe JSON can also be imported from a file.
- **Privacy:** results are encoded from a canvas, so they carry **no EXIF/GPS**. If an *original* is
  included it is metadata-stripped (re-encoded) before upload.
- **Limits to watch:** R2 free tier is 10 GB storage (egress is free); Workers free tier is 100k
  requests/day. Cheap for personal use; the expiry option keeps R2 from silently filling.
- **Revoke** deletes the whole album prefix. Trashing a run locally does *not* revoke its share
  (the gallery warns about this).

### URL loading

- Order of attempts: (1) **direct browser fetch** — works for hosts that send CORS headers and for your
  own share links; (2) on failure, **relay**: browser → `POST /api/fetch` on the potato → Worker
  `/fetch` → the origin → back.
- The Worker is the one making the outbound request, so a request can **never** reach the homelab LAN or
  tailnet (Cloudflare's network cannot see them). That removes the SSRF risk a potato-side fetcher would
  carry next to unauthenticated services like Ollama.
- Worker guards: `http`/`https` only; redirect limit; timeout; response size cap (e.g. 50 MB);
  `Content-Type` must be `image/*` (and sniffed, not just trusted); strips cookies/auth headers; secret
  required.
- The fetched **bytes are saved** as the run's original (the URL may rot), with the URL kept as
  `source_url` for provenance.
- Pasting an image URL into the intake box (or dropping a link) just works.

**Documented exception:** like Cairn, this service makes outside calls — but only to its own Worker, and
only carrying things Autumn explicitly shares or fetches. Write that into the README's security section.

---

## 7. Homelab fit

| Item | Plan |
|---|---|
| Port | **8895** (next free; `8893`/`8894` are reserved for Cairn/Coffer). Loopback only, `tailscale serve` HTTPS in front. Verify free before reserving. |
| Service shape | **Docker** (decided), following the Cairn/Warbler pattern: `~/Pixelsort/docker-compose.yml`, service `pixelsort`, image pinned by **digest** in `~/Pixelsort/.env`, built for `linux/arm64`, plus a `pixelsort-update.path`/`.service` watcher (digest pin, health check, rollback). Single static Go binary in a minimal image; multi-stage build (Node → web, Go → wasm + server). |
| Container hygiene | `restart: always` (the Meridian 2026-11-01 incident: never signal-reload a container with `docker kill`), read-only rootfs, capabilities dropped, non-root, only `data/` writable. Needs **outbound** HTTPS to the Worker — unlike Warbler, it has a route out; document it. |
| Secrets | Worker URL + shared secret in `~/Pixelsort/.env`, never in the image or repo. |
| Data | `~/Pixelsort/data/` — `pixelsort.db` (+WAL) and `images/`; **50 GB budget** |
| Health | `GET /healthz` → `{"status":"ok","version":"…"}`; must answer in ms |
| Updates | In-app, from **Settings → Updates**, same pattern as Warbler / Polaris / Ivy. Spec in [`docs/update.md`](docs/update.md). The app never touches Docker and never names an image; the host watcher resolves `:latest` to a digest, snapshots the database, pulls, health-checks, and rolls back on failure. |
| Meridian | Tile + vital (`disk_used` of 50 GB — also covers "how full is the gallery") + control target (restart/update) |
| Docs | `homelab/docs/pixelsort.md`, port-map row, and a reserved-port note — **only after Autumn approves the plan** |

---

## 8. Testing strategy

There is no Python oracle (we are deliberately changing behavior), so correctness comes from
**properties** that hold for every mode, plus a few seeded goldens:

1. Every interval is sorted by its key (and **stable** on ties).
2. **Permutation:** the output is a rearrangement of the input — per interval, per line, and overall.
3. **Frozen pixels never move** (masks, thresholds).
4. **Determinism:** same recipe + seed → byte-identical output; independent of worker count.
5. **Stepper-to-completion == instant**, for every algorithm × interval mode × angle.
6. **Line partition is a bijection** at every angle (each pixel in exactly one line, none missing).
7. Region boundaries are never crossed by an interval.
8. Fuzz: random params, odd sizes (1×1, 1×N, N×1, primes), huge/small `length`, empty masks, full masks.
9. Seeded **golden hashes** for a handful of recipes, regenerated deliberately (and `EngineVersion`
   bumped) when behavior changes on purpose.
10. Benchmarks tracked: instant sort and per-pass stepper cost at 1, 2, 8, 24 MP.
11. WASM smoke test (`GOOS=js GOARCH=wasm go test` under Node) plus a browser test of the worker round-trip.

The Python app remains a **visual** reference: run the same photo through both and compare the *look*.

---

## 9. Phases

Each phase has an exit criterion; do not start the next until it passes.

| # | Phase | Exit criterion |
|---|---|---|
| **0** | **Repo + spikes** — scaffold, Makefile, hello-world WASM in a worker, verify COOP/COEP through `tailscale serve`, read `ElementaryCAVisualizer` | A page on the tailnet loads the WASM and gets a response from Go |
| **1** | **Engine core (native Go + tests)** — image, lines, keys, intervals (random, wave, threshold, edges, none), instant sorter, properties 1–7 | `go test ./engine/...` green; a CLI-less harness renders PNGs from a recipe |
| **2** | **WASM + bare page** — wire the engine, measure zero-copy vs copy, measure pass cost at 1080p | One photo sorts in the browser; numbers recorded in `docs/perf.md` |
| **3** | **Animation** — stepper with odd-even + insertion + merge, speed/pause, reveal; property 5 | Watch a sort happen; final frame == instant |
| **4** | **CA** — `ca.go`, `ca`/`ca-edges` intervals, rule picker/preview | Cellular-automaton sorting looks right and is deterministic |
| **5** | **Real UI** — the SvelteKit app, controls, presets, threshold overlay, export/download (after §10 design talk) | Usable end to end on desktop and phone |
| **6** | **Gallery + server** — API, SQLite, upload flow, gallery view, reopen/branch, `/healthz` | Every run lands in the gallery; reopen reproduces it |
| **6b** | **Worker** — `pixelsort-share` Worker + R2, share flow (album, recipe/original opt-ins, expiry, revoke), `/fetch` + potato relay, direct-fetch-first URL loading | A link opens for someone without tailnet access; a pasted URL loads; revoke makes it 404 |
| **7** | **Regions** — mask drawing, soft/hard masks, shape auto-complete, tessellations, custom SVG, per-region settings | Draw a mask and watch the protected area stay still while everything else sorts |
| **8** | **Deploy** — homelab docs, port, Meridian tile, backups decision | Running on the potato behind `tailscale serve` |
| **9** | **Polish / stretch** — worker pool, video recording, scrubbing, more segmentations, batch | As desired |

Note: regions (Phase 7) are late in the schedule but must be **designed into the engine API from Phase 1**
(the interval code takes a region map from day one, even if it is always "everything is region 1").
Retrofitting it later is the expensive path.

---

## 10. Frontend

**Mockups:** `mockups/index.html` (open from disk). Four working directions, driven by a throwaway JS
stand-in for the engine (`mockups/shared/demo-engine.js` — not the real engine, but it implements the
scanline partition of §3.2 and passes the plan's properties 2, 1, 5 and 6 in a browser test across 15
angles × 6 interval modes × 4 image shapes, including 1×N and N×1).

**Decided (2026-11-02):**

- **Identity: B · Theater.** Stage-first, cinematic, dark, serif display + mono. Its own look, *not*
  the Grove design system. (Mockup A stays as the reference for the optional "Pro" inspector.)
- **One responsive app.** Desktop = B's floating dock of knobs, each opening one popover; phone =
  C's bottom sheet (peek / half / full) with the same controls; an optional **Pro inspector**
  (Tab) for the dense features — per-region settings, segmentation, CA rule browser, threshold
  histogram.
- **Direction is a free-form dial, any angle 0–359°** (drag, type, nudge, or pick a preset; Shift
  snaps to 15°). Dragging runs an **instant live preview**; releasing replays the animation. This is
  the same widget in the dock popover, the Pro inspector and the phone sheet. The engine must therefore
  never assume 90° steps — it does not (§3.2).
- Three live modes keep their names in the UI: *Live preview* (dragging controls), *Animate*
  (the stepper), *Reveal*.

**Screens designed (all in the Theater language, shared tokens in `mockups/shared/theater.css`):**

| Screen | Notes |
|---|---|
| **Studio** | Stage + dock of knobs, filmstrip of past runs (`G`), first-run **“Bring a picture”** intake (drop / choose / paste a file / paste a link, with a recents row), and the **Pro panel** (`Tab`): Regions (shape tiles, size / gap / turn, pattern, per-kind frozen / direction / sort key, outlines toggle) and Protect (brush, feather, clear, invert). |
| **Studio on a phone** | Same controls folded into a bottom sheet: Cut · Sort · Direction · Protect · Shapes · Runs. Free-form dial, shape-snap suggestion, share flow. |
| **Archive** | Serif usage numeral + 50 GB meter with the 80% warning mark; tabs All / Starred / Albums / Bin; “Free up space” smart-select (never sweeps in starred runs); bulk dock; full-screen viewer with the recipe as a “slate”; share dialog; Albums tab with revoke; Bin with a days-left badge and “Empty the bin”. |
| **Share viewer** | What a friend sees (served by the Worker): big image, thumbnail strip, download / zip / copy image link / copy recipe. Includes the revoked-or-expired page. |

**Responsive rules (settled in the polish pass):**

- **Studio is one container.** The stage and the dock live in a single workspace that resizes with *one*
  transition when Pro opens, so nothing slides out of sync. (An earlier version animated the stage
  padding, the picture width and the dock position separately — they drifted, and the dock got pushed
  off-screen and hidden under the panel.)
- **Pro pushes the stage on wide windows (≥ 1240 px) and overlays it on narrower ones**, with a light
  scrim you can click to dismiss. It never squeezes the picture into a thumbnail.
- **The dock tightens in two steps as its container narrows** (container queries), and scrolls
  sideways as a last resort. It must never overflow the viewport.
- The centred readout (pass / % / intervals) hides below 1440 px so it can't collide with the links (Studio's top bar also has a gear into Settings now); the
  caption hides its dimensions line and ellipsizes rather than overlapping the picture.
- **Below ~700 px the Studio hands off to the phone layout.** Archive and the share viewer are fluid
  down to phone width (the viewer stacks image-over-slate below 1000 px).
- Visible keyboard focus rings everywhere; `prefers-reduced-motion` turns animation off (grain included).
- A scripted check (every screen × 4 window sizes: overflow, clipped UI, bar collisions) belongs in the
  real app's browser tests too.

**Behaviours the mockups settled:**

- Dragging the dial (or a region slider) gives an **instant live preview**; releasing replays the animation.
- Dropping, pasting or choosing a file loads it for real; a pasted link tries a direct fetch first and
  shows the Worker-relay fallback when blocked.
- The intake, the Pro panel and the viewer all close with `Esc`; `N` opens the intake.
- A pasted or dropped image works anywhere in the Studio, not only on the intake screen.

**Masks as editable objects (added after review):** shapes you can drag / resize / turn on the picture, union
vs hole, invert toggle, snap-to-shape, brightest-spot — on desktop **and** the phone sheet (Move shapes / Paint /
Erase tool switch; Size and Turn sliders for thumbs).

**Designed since:** the custom-shape library (starters, upload, paste, saved shapes, staggered arrangement)
and per-region overrides — foldable region cards with a one-line summary (“90° · cellular 110”), Own
direction, Own sort key + direction, and a full Own cutting recipe.

**Designed since (second batch):**

- Holes and compound paths in custom shapes (even-odd fill), a "tidy this shape" panel (pieces, keep holes,
  fill small holes, simplify), and Ring / Frame / Target starters.
- A per-region *animation algorithm*; the engine's `step()` runs three families side by side and any mix ends
  on the instant result.
- Own-cutting on the phone: it now has the full region cards, shared with Studio's Pro panel
  (`shared/region-cards.js`), plus threshold, edge and cellular controls on the Cut tab.
- The filmstrip at scale: dated, virtualised, searchable rows with a jump rail, tested at 2,000 runs.
- Empty, offline and storage-full states (80% warning, 100% still saves, never deletes), and an 11-code error
  catalog with blocking dialogs and a non-blocking banner across every screen.
- First-run tour, shortcut sheet (`?`) and Settings with credits.
- Presets (the eight Python built-ins as rolled specs, plus user presets), the `T` "what can move" overlay,
  and the export planner and dialog (8 B/px floor + 9 B/px scratch per band).
- Naming: click or tap the caption in Studio / phone (or `F2`), or the title in the Archive viewer. Names are labels, not identities (duplicates allowed); clearing the field returns the automatic name; the export filename is built from the name and drops a recipe word the name already contains (`shared/naming.js`).
- An "update is ready" dot on every way into Settings (Studio gear, phone gear, Archive link). It only reads what the watcher last wrote; it never starts a check.
- Settings → Updates: check, update, progress that survives the server restarting, failure and rollback states (`shared/updater.js`).

Nothing is left on the design list; the mockup phase is finished and the next step is Phase 0 (§9).

**Icons: Lucide** (Autumn's call). Use `@lucide/svelte` (Svelte 5; Svelte 4 projects would use `lucide-svelte`),
importing one icon per file — `import Camera from '@lucide/svelte/icons/camera'` — so only the icons actually
used are bundled. Props are `size` (default 24), `color` (default `currentColor`, so our theme tokens just
work) and `strokeWidth` (default 2; the mockups use ~1.7 for the lighter Theater feel). The inline SVGs in
the mockups are hand-drawn placeholders in the same style; swap them for real Lucide icons when the Svelte
UI is built (Phase 5). The dial, region tiles and shape previews stay custom — they are drawings of *the
engine's* concepts, not UI glyphs.

**Constraints that already exist:**

- Phone-first matters in this homelab (Meridian is explicitly phone-first: no keyboard-only paths).
  Touch drawing for masks, and sliders that work with a thumb.
- The **stage** (canvas) is the hero: live sort visible while controls are adjusted.
- Needs: image intake (pick/drop/paste), controls, preset picker, animation transport (play/pause/speed/
  algorithm), drawing tools (brush, shape, undo, snap suggestion, feather), segmentation controls,
  threshold overlay toggle, before/after compare, download, gallery, run detail with "branch from here".
- Candidate design skills already installed: `design-taste-frontend`, `high-end-visual-design`,
  `minimalist-ui`, `frontend-design`, `impeccable`.

---

## 11. Decisions

Settled with Autumn (2026-11-02):

| # | Decision |
|---|---|
| D1 | **Disk budget 50 GB** for the gallery; warn at 80%; never auto-delete. |
| D2 | **Docker**, digest-pinned, Cairn/Warbler pattern — consistent with the rest of the homelab and easy for Meridian to update. |
| D3 | **URL loading is in.** Fetch proxy is the **Cloudflare Worker** (cannot reach the LAN → no SSRF), relayed via the potato so the secret never reaches the browser; direct browser fetch is tried first. |
| D4 | **Share links** = an **album** of selected gallery runs, unlisted URL, results by default, recipe/original opt-in, optional expiry, revocable. |
| D5 | **Bulk delete → Trash with 7-day undo.** Starred runs are excluded from "select all". |
| D6 | Module path **`github.com/AutumnsGrove/pixelsort-go`**. |
| D7 | Images are not all backed up to R2; recipes/DB and starred results are the minimum worth backing up. |
| D8 | Previous decisions: faithful-port is *not* a goal (improve freely); sort along **scanlines** instead of rotating; **downscaled working copy** for animation + full-res export; **standard Go** WASM; **auto-save every run**. |

Defaults chosen by the planner (overrule any of these):

| # | Default |
|---|---|
| P1 | **CA mask space:** build both (`ca_space: image \| line`), choose the default after seeing them in Phase 4. |
| P2 | **Angle:** 0° sorts left→right; increasing angle rotates the sort direction counter-clockwise *as seen on screen*; the UI dial draws an arrow in the sort direction, and 180° reads as "right→left". |
| P3 | **Working resolution:** long edge capped at 1920 px on desktop, 1280 px on phone, user-adjustable; export is always full resolution, banded, with a warning when a device's memory estimate is exceeded. |
| P4 | **Wave intervals:** sine-modulated length with amplitude and period controls, plus an optional noise term. |
| P5 | **Animation replay at full resolution:** not in v1. |
| P6 | **License:** MIT — upstream `satyarth/pixelsort` and the predecessor repo are both MIT (checked 2026-11-02). Credits are in the README. |

Still open (none block Phases 0–4):

- **Share Worker name, Cloudflare account/zone**, and whether the viewer lives on a custom domain or `*.workers.dev`.
- **Share expiry default** (never vs 30 days).
- **Which tailnet origin** the Worker should trust for CORS on `/fetch`, if any (the secret already gates it).
- Backup cadence details (Phase 8).

## 12. Risks

| Risk | Mitigation |
|---|---|
| Animation not smooth at useful resolutions | Phase 2 spike measures it first; downscaled working copy; worker + OffscreenCanvas; steps-per-frame control |
| Go WASM size/startup | Gzip/brotli, lazy load, TinyGo as an escape hatch |
| `SharedArrayBuffer` blocked by headers/secure context | Verify in Phase 0; single-worker fallback still works |
| Memory limits on phones | Device-aware caps, banded export, honest messaging |
| Region API retrofitted late | Region map in the engine API from Phase 1 |
| Gallery disk growth | 50 GB budget, usage meter + 80% warning, bulk delete + trash, regenerate-from-recipe fallback |
| Worker used as an open proxy | Shared-secret required on every route except viewer reads; potato is the only holder of the secret; size/type/redirect/timeout guards; rate limiting |
| Share link leaks personal data | Canvas-encoded results carry no EXIF; originals re-encoded and opt-in; album IDs are unguessable; revoke deletes the R2 prefix |
| Shared links outlive local deletes | Gallery warns before trashing a shared run; revoke is a separate, visible action |
| R2 / Workers free-tier limits | Expiry option; usage shown in the share dialog; fall back to paid tier if ever needed |
| Cloudflare dependency | App works fully without it; only share links and URL loading need the Worker |
| Behavior drift between engine versions | `engine_version` stored with every run; golden hashes |

---

## Appendix A — What the Python actually does (audit)

Read in full on 2026-11-02. Facts that shaped the decisions above.

**Pipeline** (`core/processor.py`, `core/sorting.py`): open → convert RGBA → rotate (`expand=True`,
nearest) → pixel array of tuples → interval function → per-interval `sorted(..., key=fn)` (stable) →
`putpixel` loop → rotate back and center-crop/resize.

**Quirks:**
- "lightness" = HSV value = `max(r,g,b)` ⇒ same ordering as the "maximum" sort.
- `random` interval width = `clength × (1 − random())`; mean ≈ `clength/2`.
- "waves" = `clength + randint(0,10)`; no actual wave.
- `threshold`: boundaries at out-of-range pixels, which then join the *next* interval and get sorted.
- `edges`: the helper that makes the edge map writes white for *low* lightness and black for edges, and
  black is what becomes a boundary (confusingly inverted names). Cleanup loop runs right-to-left,
  mutating in place, from `len−1` down to index 2, so columns/rows 0–1 are never cleaned.
- `edge_intervals` reloads the image from disk via `args["url"]` (the cause of the recent "file not found"
  fixes). In its fallback it rebuilds the image from already-rotated pixels and rotates *again*.
- `file`/`file-edges`: CA generated at 1/4 size (1/8 above 2500 px), Lanczos-upscaled, compared to
  *exact* black. `file-edges` rotates the mask with `expand=False` while the image rotated with
  `expand=True`, then resizes — the mask is stretched to fit.
- `randint(0,100) >= randomness` has 101 outcomes.
- Rotation fills corners with transparent black `(0,0,0,0)`; those pixels are sorted like any other.
- `sort_image` has a branch (`x_min == 0` after the loop) that looks dead.
- Presets: 8 built-ins; their random values are generated **once at import**, so a preset is identical
  until the app restarts. Random/Kims pick from only 5 of 10 sort keys. Custom presets are saved to
  `~/.pixelsort_custom_presets.json`. "Kims" = threshold intervals at 90° (Kim Asendorf's script).
- `AdvancedConfig` is mostly dead flags. `config/default.yaml` is a stub (e.g. `max_threads: 4`).

**UI (Gradio) features:** upload + example images, interval/sort dropdowns, randomness, angle (+ dial
preview), image-scale %, thresholds (+ bar preview + live "focus peaking" overlay), characteristic length,
CA rule slider (+ preview image + recommended-rules notes), presets tab (load/save), progress bar by
weighted step, status text.

**The never-built shapes/drawing plan** (`pixelsort/Next Project - Shapes and Drawing.md`, six sessions):
mask-based exclusion with smooth drawing and auto shape completion (Hough circles / contour polygon
detection via OpenCV-style analysis); segmentation into circle/hexagon/triangle/octagon/pentagon/square/
diamond/stars/ellipse/custom-SVG grids with spacing/overlap/rotation; per-segment settings; reassembly
with blend modes; feathering, morphology, multiple mask layers, Voronoi/content-aware segmentation;
project save/load, batch, caching, 50 MP target; enhanced presets; undo/redo; tests and docs. This plan
maps onto §3.4 (regions) and §4; the Gradio-specific parts (ImageEditor, debounced events) dissolve in a
real front end.
