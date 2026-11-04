# Phase 7: regions, masks and custom shapes

**Goal.** Everything the Pro panel's Regions and Protect sections do, for real: tessellations (seven shapes plus
custom polygons, with holes), patterns, per-class overrides, mask objects and brush strokes, feather, "freeze the
brightest spot", snap-to-shape, SVG import with a tidy-up step. The engine rasterises everything from **vector
descriptions** so the preview and the full-resolution export agree.

**Spec sources.** `PLAN.md` section 3.4 (read all of it), decisions E10 and E11, and the working mockups:
`mockups/shared/regions.js` (tessellate, classify, polygon handling), `shared/mask-editor.js`,
`shared/region-cards.js`, `mockups/studio.html` (Pro panel) and `mockups/phone.html` (Shapes and Protect tabs), plus the
tests `region-properties.mjs`, `region-algo.mjs`, `region-cards.mjs`, `custom-shapes.mjs`, `shape-holes.mjs`,
`shape-tidy.mjs`, `mask-editor.mjs`, `phone-mask.mjs`.

**Depends on.** Phase 1 (regions plumbing already exists in the engine), phases 3 and 5 (stepper, UI).

**Exit criteria.**
1. All region properties hold for every shape x pattern x size (the mockup's 56 configurations, widened).
2. Tessellation goldens pass on arm64, amd64 and WASM.
3. Every mockup test listed above has a passing real counterpart (table in P7-T14).
4. A photo can be cut into hexagons, with one kind frozen, one re-angled and one using a different algorithm, in
   Studio and on the phone, and the export matches the preview in character.

Branch: `build/phase-7`.

---

## Rules specific to this phase

**Floating point is allowed in tessellation geometry, with one condition.** Geometry here (rotation by an angle,
hexagon rounding, circle tests) is much easier with floats than integers. Cross-platform determinism is kept by
the same rule as decision E6: **wrap every product in an explicit `float64(...)` conversion** so arm64 cannot fuse
multiply-adds (`float64(a*b) + c`, never `a*b + c`), and use only `+ - * /`, `math.Sqrt`, `math.Floor`, `math.Round`
and `math.Sincos` of whole-degree angles (all exactly rounded or pure Go on arm64, amd64 and WASM). The
**cross-platform golden test decides**: if a label map differs between platforms, switch that shape to fixed-point
integers rather than changing the golden.

**Everything vector, rasterised in Go.** JavaScript never sends a region bitmap built in a canvas (canvas fills are
anti-aliased and cannot be turned off, so edges would blend two ids into a bogus third: PLAN.md 3.4). It sends *specs*;
the engine rasterises them at whatever size is needed.

**Units.** `size` and `gap` of a tessellation are **per-mille of the image width** (decision E4); `rotate` is whole
degrees; positions of mask objects and polygons are **fractions of the picture** (0 to 1).

---

## The specs (JSON, shared by Go and TypeScript)

```go
package shapes

type Tiling struct {
	Shape   string      `json:"shape"`            // square|hexagon|triangle|diamond|circle|octagon|voronoi|custom
	Size    int         `json:"size"`             // per mille of width, 10..1000
	Gap     int         `json:"gap"`              // per mille of width, 0..200
	Rotate  int         `json:"rotate"`           // degrees 0..359
	Seed    uint32      `json:"seed"`             // voronoi sites, random pattern
	Stagger bool        `json:"stagger,omitempty"`// custom: brick offset on odd rows
	Poly    [][2]float64 `json:"poly,omitempty"`  // custom: outline in the unit square
	More    [][][2]float64 `json:"more,omitempty"`// custom: extra rings (holes or pieces), even-odd
	Pattern string      `json:"pattern"`          // all|checker|thirds|random
	Kinds   int         `json:"kinds,omitempty"`  // random: how many classes (default 3)
}

type Cells struct {
	Labels []uint16 // per pixel; 0 = between shapes
	CI, CJ []int32  // per cell id: grid coordinates (cell 0 unused)
	Count  int
}
```

```go
// package masks
type Object struct {
	Kind string  `json:"kind"`           // ellipse|rect|polygon
	CX, CY, W, H float64                 // fractions of the picture (json cx, cy, w, h)
	Rot  float64 `json:"rot"`            // degrees
	Mode string  `json:"mode"`           // add (freeze) | cut (punch a hole)
	Poly [][2]float64 `json:"poly,omitempty"` // polygon kind: unit-square outline
}
type Stroke struct{ Radius float64 /* fraction of width */; Erase bool; Points [][2]float64 /* fractions */ }
type Spec struct { Objects []Object; Strokes []Stroke; Invert bool; Feather float64 /* fraction of width */ }
```

---

### P7-T01 · Tessellation core: square, diamond, circle, octagon

**Port of.** the `else` branch of `tessellate` in `mockups/shared/regions.js` (and `square`/`diamond`/`circle`/`octagon`).

**Files.** `engine/shapes/tiling.go`, `tiling_test.go`, `tiling_fuzz_test.go`.

**Spec.** `Tessellate(w, h int, t Tiling) (Cells, error)`. For each pixel: rotate about the image centre by `-Rotate`
degrees (`Sincos` of the integer angle, all products wrapped), translate by a large offset so coordinates stay positive,
find the grid cell, test whether the pixel is inside the cell's inset shape (`R = S/2 - gap/2`; square: box; circle:
`lx*lx+ly*ly <= R*R`; octagon: `|lx|+|ly| <= R*1.4142`; diamond: the grid rotated 45 degrees), and assign a cell id from a
**slice-backed** dictionary keyed by `(i, j)` (do **not** iterate a Go map to number cells: ids are assigned in first-seen
pixel order, which is deterministic). `S = max(6, pixels(Size))`, `gap = pixels(Gap)`.

`pixels(v) = max(1, (w*v + 500)/1000)` for size and `(w*v + 500)/1000` (may be 0) for gap.

Return `error` for unknown shapes, `w` or `h` < 1, or more than 65535 cells (labels are `uint16`).

**Tests first.**
- A 12x12 image, `square`, size such that `S = 4`, gap 0, rotate 0: 9 cells, each 4x4, ids `1..9` in raster order of first
  pixel (state the full label grid in the test).
- Gap 2 gives gap pixels (label 0) between cells and none on the outer border beyond the inset.
- `circle` has fewer labelled pixels than `square` at the same size; `octagon` between them.
- Rotation 90 of a square tiling on a square image gives the same *set* of cell shapes (counts equal).
- `TestProp_Tessellate`: any `w,h <= 90`, any shape here, size, gap, rotate: labels length `w*h`, every label `<= Count`,
  every id in `1..Count` occurs at least once, cell 0 allowed anywhere, deterministic (twice equal).
- Cell ids are contiguous (no gaps in `1..Count`).
- `FuzzTessellate(w, h, shapeIdx, size, gap, rotate)`: clamp (do not skip), no panic, `Count <= 65535` or an error.

**Verify.** `go test ./engine/shapes -race`; fuzz 20s.

**Commit.** `Add square, diamond, circle and octagon tilings`

---

### P7-T02 · Hexagon, triangle, Voronoi

**Port of.** the `hexagon`, `triangle` and `voronoi` branches in `tessellate`.

**Files.** `engine/shapes/hex.go`, `triangle.go`, `voronoi.go`, tests.

**Spec.**
- **Hexagon:** cube-coordinate rounding as in the mockup (`q = (sqrt(3)/3*rx - ry/3)/Rc`, `r = (2/3*ry)/Rc`, round the
  three cube coordinates and fix the one with the largest rounding error); inside test
  `lx <= R*sqrt(3)/2 && ly + lx/sqrt(3) <= R` with `R = Rc - gap*0.6`. Wrap products in `float64()`.
- **Triangle:** the two-triangles-per-parallelogram scheme of the mockup with barycentric margin test against `gap/2`.
- **Voronoi:** `n = max(6, w*h / (S*S*1.1))` sites placed with `NewStream(seed, 0x564F)` (`RNG.Uint32n(w*1000)/1000` style:
  place each site at `x = float64(rng.Uint32n(uint32(w)*256))/256` and likewise `y`, so only integer RNG output feeds a
  single division); a pixel belongs to its nearest site unless the distance gap to the second nearest is below `gap`.
  Use a **grid acceleration** (bucket sites into cells of size `S`) so 8 MP does not take `w*h*n` operations; a property
  test checks it against brute force on small images.
- Same cell-numbering rule as T01.

**Tests first.** Hex: the cell centred on the image centre contains the centre pixel; six neighbours around it for a large
image; cell count within 20% of `w*h / (hex area)`. Triangle: pixels in the same parallelogram split into exactly two cells.
Voronoi: every pixel's label is its nearest site's id (brute-force oracle on 40x40, gap 0); gap > 0 leaves label-0 seams only
near boundaries; same seed same map; different seed different map. Properties from T01 hold for all three.

**Verify.** `go test ./engine/shapes -race`; benchmark Voronoi at 8 MP (record in `docs/perf.md`).

**Commit.** `Add hexagon, triangle and Voronoi tilings`

---

### P7-T03 · Custom polygons with holes

**Port of.** `polyBits` and the `custom` branch of `tessellate` (even-odd rule, `More` rings, stagger).

**Files.** `engine/shapes/custom.go`, `custom_test.go`.

**Spec.** Rasterise `Poly` plus `More` into a 72x72 bitmap over the unit square with the **even-odd** rule (ray casting at
pixel centres, rings XOR-ed: a ring nested inside the outline is a hole, one outside is another piece). Tile the bitmap on
the grid like the mockup (`scale = max(0.06, (S-gap)/S)`, `stagger` shifts odd rows by `S/2`); a pixel is labelled when its
position inside its tile maps to a set bitmap cell. Validate: at least 3 points per ring, finite coordinates in `[-0.5, 1.5]`,
at most 2000 points in total (errors, not panics).

**Tests first.** A full-square polygon fills tiles completely (labels equal the `square` tiling at gap 0); a ring (outer
square, inner square) leaves the centre of each tile as label 0 (hole); two disjoint triangles in one tile give two
separate filled pieces with one cell id; stagger offsets odd rows (compare column of cell ids); degenerate input (2 points,
NaN as a decoded float, 2001 points) returns errors; `TestProp_Custom`: random convex polygons give labelled area between 0 and
the tile area.

**Commit.** `Add custom polygon tiling with holes`

---

### P7-T04 · Classes and patterns

**Port of.** `classify` and `hash` in `mockups/shared/regions.js`.

**Files.** `engine/shapes/classify.go`, `classify_test.go`.

**Spec.** `Classify(c Cells, pattern string, kinds int, seed uint32) []uint8` returns `classOf` indexed by cell id (cell 0 is
class 0; real cells are classes `1..`): `all` -> 1; `checker` -> `1 + ((i+j)%2+2)%2`; `thirds` -> `1 + ((i+j)%3+3)%3`; `random` ->
`1 + hash(id*2654435761 + seed) % max(1,kinds)`. The mockup's `hash` ported with **`uint32` wrap-around**:

```go
func hash(n uint32) uint32 { // matches mockups/shared/regions.js hash(), whose JS int ops wrap at 32 bits
	n = (n ^ 61) ^ (n >> 16)
	n += n << 3
	n ^= n >> 4
	n *= 0x27d4eb2d
	n ^= n >> 15
	return n
}
```

with `n0 = uint32(uint64(id)*2654435761 + uint64(seed))`. (JS evaluates `id*2654435761 + seed` as a double and converts to a
32-bit int, which is the same as reducing modulo 2^32.)

Also `BuildRegions(c Cells, classOf []uint8, defs []engine.ClassDef) *engine.Regions` and **class 0 frozen by default**: the
builder sets `defs[0].Frozen = true` unless the caller supplied a definition for class 0 (decision E10; unfrozen gaps would sort
along whole rows and leave glitch lines along the seams).

**Tests first.** Hash known values (compute five by running the mockup's JS once and pasting them: `node -e` with the function
copied from `regions.js`; show the command in a comment); `checker` alternates on a 2x2 cell grid; `thirds` cycles; `random` uses
only classes `1..kinds`; same seed same classes; class 0 frozen by default and overridable.

**Commit.** `Add class patterns and region builder`

---

### P7-T05 · Region properties and goldens

**Port of.** `mockups/tests/region-properties.mjs`, `region-algo.mjs`, `custom-shapes.mjs` (properties), `shape-holes.mjs` (even-odd).

**Files.** `engine/shapes/regions_prop_test.go`, `engine/shapes/golden_test.go`, `engine/regions_algo_test.go`.

**Spec.** Over **every shape x every pattern x sizes `{120x80, 61x97, 97x61, 1x40, 40x1}`** with defs
`{1: frozen, 2: angle 100 + key hue, 3: angle 300 + reverse}`:
1. line coverage is exactly `w*h` with no duplicates;
2. output is a permutation of the input;
3. frozen-class pixels never move;
4. no interval crosses a cell, and each interval is sorted by **its class's** key (compute with that class's `KeyFor`);
5. stepper to completion equals `Sort()`;
6. with per-class cutting overrides (threshold / cellular (needs phase 4) / wave at different angles with reversed keys, the
   32 configurations of the mockup: 8 shapes x grid/staggered x 2 patterns), the same five hold;
7. any mix of algorithms per class ends on the instant result (`region-algo.mjs`).

Goldens: label-map SHA-256 for each shape on `97x61` (`tess-<shape>.sha256`) and one full recipe hash
(`regions-hex-checker.sha256`), checked on arm64, amd64 and WASM.

**Tests first.** These are the tests; write them before touching `Plan` if any property fails (a failure here is a bug to fix
in phase 1/3 code, with its own commit: `Fix <thing> (P7-T05)`).

**Verify.** `go test ./engine/... -race -rapid.checks=500`; `GOARCH=amd64 go test ./engine/shapes -run Golden`;
`make wasm-test`.

**Commit.** `Add region properties and goldens`

---

### P7-T06 · Masks: objects, strokes, invert, brightest spot

**Port of.** the mask model in `mockups/shared/mask-editor.js` and the brightest-spot code in `studio.html` (`brightSpot`).

**Files.** `engine/masks/masks.go`, `masks_test.go`, `engine/analysis.go`, `analysis_test.go`.

**Spec.**
- `Rasterize(w, h int, s Spec) []uint8` (1 = frozen): start from strokes in order (round-capped polylines of the stroke's
  radius, `Erase` clears), then apply objects **in order**: `add` freezes the object's pixels, `cut` punches a hole; ellipse and
  rect are rotated about their centre (`Rot` degrees); polygon uses even-odd on the unit-square outline scaled into the object's
  box. Finally `Invert` flips every pixel. Hard edges (no anti-aliasing). Float geometry follows the phase rule (wrapped products).
- `Soft(w, h int, mask []uint8, featherFraction float64) []uint8` = `engine.Feather` with radius
  `round(featherFraction*w)`.
- `BrightestSpot(im *Image) (cx, cy, w, h float64)`: the top 1.5% of pixels by luma (find the threshold with a 256-bin
  histogram), centroid, radius `sqrt(count/pi)*1.15`, returned as fractions (`w = h = 2*radius/width`... use width and height
  separately like the mockup). Pure integer sums until the final divisions.

**Tests first.** Rect covering the left half freezes exactly `w/2 * h` pixels (hand case 10x4); `cut` inside an `add` leaves a hole;
order matters (cut before add leaves the area frozen); `Invert` of an all-frozen mask is all zero and `Invert` twice is the
identity; rotating a rect by 90 degrees swaps its extent; strokes with `Erase`; `TestProp_RasterizeRange` (values 0/1,
length `w*h`); brightest spot on an image with one bright blob lands inside the blob; on a flat image does not panic and returns a
finite ellipse; deterministic; golden hash for one composite spec on 97x61.

**Commit.** `Add mask rasterisation and brightest spot`

---

### P7-T07 · Session API and WASM for regions

**Files.** `engine/api/session.go` (extend), `engine/api/session_regions_test.go`, `cmd/wasm/main.go` (extend).

**Spec.** Add:

```go
func (s *Session) SetTiling(specJSON []byte, defsJSON []byte) error // tessellate at the working size, classify, build regions
func (s *Session) SetMaskSpec(specJSON []byte) error               // rasterise masks.Spec; sets Mask and Soft
func (s *Session) Labels() []uint16                                 // current region labels (for outline drawing), nil if none
func (s *Session) ClassOf() []uint8
func (s *Session) BrightestSpot() (cx, cy, w, h float64, err error)
func (s *Session) Sortable() []uint8                                // 1 where a pixel is in some interval (phase 5)
```

`SetTiling(nil, nil)` clears. The old `SetRegions(labels, ...)` stays for tests. JS binding mirrors each (`setTiling`,
`setMaskSpec`, `labels()` returns a pointer and length like `pixelsPtr`, `brightestSpot()`).

**Export at full resolution** works because the spec is vector: `Init(fullW, fullH)`, the same `SetTiling` and `SetMaskSpec`
calls, then the banded sort of phase 5. Add a test: the *character* matches between a 640-wide and a 1280-wide run of the same
spec (same number of cells within 5%, same class areas within 3% of the image).

**Tests first.** Native session tests for each call and for the full-resolution consistency check above; extend
`web/scripts/wasm-golden.mjs` with the region goldens.

**Commit.** `Add region calls to the session API`

---

### P7-T08 · TypeScript geometry modules

**Port of.** `mockups/shared/regions.js` (SVG parts), `mask-editor.js`, `region-cards.js`, and the matching tests.

**Files.** `web/src/lib/svg-shapes.ts` (+test), `shape-tidy.ts` (+test), `snap.ts` (+test), `mask-model.ts` (+test),
`region-cards.ts` (+test).

**Spec and tests (port the assertions of each mockup test):**
- `svg-shapes.ts`: read an SVG string as **data** (never inserted into the page): `DOMParser`, pick `path/polygon/polyline/
  circle/ellipse/rect`, measure with a hidden off-DOM SVG's `getTotalLength`/`getPointAtLength` (clone nodes in, remove after),
  split into rings where the path jumps. Errors: not SVG, no shapes, nothing measurable (the three messages from the mockup). Test
  with the starter shapes (Star, Heart, Ring, Frame, Target, ...): ring counts (Ring = 2, Target = 3), nesting depth by even-odd.
  Add an XSS test: an SVG with `<script>` and `onload` produces shapes and **no script runs** (assert a global flag stays unset).
- `shape-tidy.ts`: `buildShape(raw, {pieces, holes, minHole, simplify})` as the mockup (largest piece vs all, keep holes, drop
  small holes by area fraction, Douglas-Peucker with `eps = simplify * diagonal`); `needsTidy`; stats text ("2 pieces, 1 hole,
  84 points"). Port `shape-holes.mjs` and `shape-tidy.mjs` assertions.
- `snap.ts`: stroke to shape suggestion: resample, closure test, least-squares circle/ellipse fit, Ramer-Douglas-Peucker corner
  count (3 triangle, 4 rectangle/diamond, 5/6/8 pentagon/hexagon/octagon); returns a suggestion or `null`; accepting
  *replaces the stroke* with an object (never doubles up). Port the loop-snap assertions of `mask-editor.mjs`. Add property tests
  with `fast-check` (or hand-rolled seeded loops): a noisy circle of 200 points is suggested as an ellipse/circle; a random
  scribble that is not closed gives `null`.
- `mask-model.ts`: objects `{kind, cx, cy, w, h, rot, mode}` as **fractions**; move, resize (corner handles, Shift keeps
  proportions), rotate (handle, Shift snaps to 15), nudge, duplicate, delete, invert toggle (a toggle, never a bake); handle
  geometry maths (pure); serialise to `masks.Spec`. A shared JSON fixture (`engine/testdata/mask-spec-cases.json`) checks
  that the TypeScript serialiser's output is accepted by Go (`masks` test loads the same file).
- `region-cards.ts`: the card model: one-line summary ("90 degrees, cellular 110"), Own direction, Own sort key and direction,
  Own cutting recipe; produce `ClassDef` JSON. Port `region-cards.mjs` model assertions; a fixture shared with Go checks
  the produced `ClassDef` JSON parses in `engine`.

**Verify.** `pnpm --dir web test`; `go test ./engine/... -run Fixture`.

**Commit.** `Add region geometry modules`

---

### P7-T09 · Pro panel: Regions

**Port of.** the Regions part of the Pro panel in `mockups/studio.html`.

**Files.** `web/src/lib/components/pro/Regions.svelte`, `ShapeTiles.svelte`, `Outlines.svelte`, store additions.

**Spec.** Shape tiles (none + seven + custom), Size, Gap, Turn, pattern (all/checker/thirds/random with kinds), outlines
toggle (drawn on a canvas from `labels()`), per-kind frozen/direction/sort key, class swatches. Changing anything sends
`setTiling` then a live preview. Size, Gap and Turn show pixels at the current working size but store per-mille.

**Tests first.** Playwright: choose hexagons, pattern checker: outlines appear (canvas has non-transparent pixels); freeze kind 1:
pixels of kind 1 identical to the original after the sort (compare against the engine's `Sortable()` map); give kind 2 its own
direction and see the card summary update; outlines toggle hides them; sliders are keyboard operable.

**Commit.** `Add Regions panel`

---

### P7-T10 · Region cards

**Files.** `web/src/lib/components/RegionCard.svelte`, used by Studio's Pro panel **and** the phone sheet.

**Spec.** Foldable cards with the one-line summary; Own direction (the angle dial), Own sort key + direction, Own animation
algorithm, Own cutting recipe (mode, length, band, edge sensitivity, CA rule and cell, unsorted). One component, two layouts
(the phone gets 44 px targets). Anything unset inherits the global setting.

**Tests first.** Port `region-cards.mjs` (browser): same flows in Studio and on the phone; summaries; inherit/own toggles.

**Commit.** `Add region cards`

---

### P7-T11 · Protect: brush, objects, feather

**Port of.** the Protect section of `mockups/studio.html`, `mockups/tests/mask-editor.mjs`.

**Files.** `web/src/lib/components/pro/Protect.svelte`, `MaskOverlay.svelte` (SVG handles), `Brush.svelte`, store additions.

**Spec.** Brush (`P`) with size and erase, strokes stored as **vector** strokes (normalised points), drawn live on an overlay
canvas and rasterised by the engine; feather slider; invert toggle; clear; undo/redo on strokes and objects; the object list
with Freeze/Hole toggle; the selected object is edited **on the picture** with SVG handles (move, corner resize with Shift for
proportions, rotate handle with Shift snapping to 15, arrow-key nudge, exact number fields); "Looks like a circle, Snap" after
a closed loop; "Freeze the brightest spot" calls `brightestSpot()`.

**Tests first.** Port every step of `mask-editor.mjs` with real pointer input (18 checks): add, drag, resize, rotate by handle and
by number, exact size, hole, invert, Delete key, remove all, brightest spot then drag, loop then snap then editable. Add: undo
restores a removed object; strokes survive a window resize (vector, not pixels).

**Commit.** `Add Protect panel`

---

### P7-T12 · Shape library

**Port of.** the shape library and tidy panel in `mockups/studio.html`, `custom-shapes.mjs`, `shape-tidy.mjs`.

**Files.** `web/src/lib/components/pro/ShapeLibrary.svelte`, `TidyPanel.svelte`.

**Spec.** Eleven starters (Star, Heart, Drop, Bolt, Moon, Leaf, Cross, Arrow, Ring, Frame, Target; data from
`STARTERS` in `regions.js`), "Your shapes" (stored on the server via `/api/shapes`, `localStorage` fallback), drop or paste an
`.svg` **anywhere** in Studio to add it as a shape (not as the picture), paste SVG code, grid or staggered tiling, and the
**tidy panel** (pieces, keep holes, fill small holes, simplify) shown when `needsTidy`. SVG text is parsed as data and discarded.

**Tests first.** Port the browser parts of `custom-shapes.mjs`, `shape-holes.mjs`, `shape-tidy.mjs`: starters tile; Ring leaves
holes in the label map; dropping an SVG file adds a shape and does not replace the picture; a malicious SVG runs no script;
the tidy options change the point and piece counts; saved shapes survive reload and sync to the server.

**Commit.** `Add shape library and tidy panel`

---

### P7-T13 · Phone: Protect and Shapes tabs

**Port of.** `mockups/phone.html` (Protect and Shapes tabs), `tests/phone-mask.mjs`.

**Spec.** The same stores and components in the bottom sheet: Move shapes / Paint / Erase tool switch, Size and Turn
sliders for thumbs, starters, region cards. All targets >= 44 px; nothing overflows at 390x844.

**Tests first.** Port `phone-mask.mjs` and the phone layout checks.

**Commit.** `Add phone Protect and Shapes tabs`

---

### P7-T14 · Acceptance and wrap-up

Fill the remaining rows of the acceptance table in `NOTES.md` (see phase 5, P5-T23): every region/shape/mask mockup test
has a passing real counterpart. Run everything (`make check`, `make test`, `make wasm-test`, `node web/scripts/wasm-golden.mjs`,
`pnpm --dir web test`, `make e2e`). Remove the "arrives with phase 7" flag from the Pro panel. Tick `PROGRESS.md`.

**Commit.** `Finish phase 7`
