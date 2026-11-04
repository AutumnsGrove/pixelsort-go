# Phase 4: cellular-automaton intervals

**Goal.** Elementary 1-D cellular automata (Wolfram rules 0 to 255) as interval masks, in two modes (`ca`,
`ca-edges`) and two spaces (image space, line space), fully deterministic. Removes the `ErrNotImplemented` from
phase 1.

**Spec sources.** `PLAN.md` 3.6; `decisions.md` E7; the stand-in `caMap()` in `mockups/shared/demo-engine.js` (and
how `_build` uses it: a cut where the mask goes from 0 to 1 along the line); `~/Documents/Projects/ElementaryCAVisualizer`
(p5.js CA visualiser by Autumn) for rendering ideas, optional reading.

**Depends on.** Phase 1. Independent of phases 2 and 3 (but update the golden WASM check if phase 2 exists).

**Exit criteria.**
1. `ca` and `ca-edges` work in `NewPlan`, and every phase 1 property still holds with them included.
2. Known rule vectors match (rule 30, 90, 110 from a single cell).
3. Image space and line space agree at angle 0.
4. Golden hashes added for CA recipes pass on arm64, amd64 and (if phase 2 is done) WASM.

Branch: `build/phase-4`.

---

## Model

A CA mask is a `w x h` plane of 0/1 (non-zero = "on"), made from a grid of `cw x ch` cells:

- `cellPx = max(1, (W*Cell + 500) / 1000)` (decision E4), `cw = ceil(W / cellPx)`, `ch = ceil(H / cellPx)`.
- Row 0 of the grid is random: `rng.Uint32n(2)` per cell from `NewStream(seed, 0xCA000000 | rule)`.
- Row `y` comes from row `y-1` by the rule: `idx = left<<2 | centre<<1 | right`, `new = (rule >> idx) & 1`.
- **Boundary** (`CABoundary`): `random` (the two edge cells of each row are drawn fresh from the same stream,
  as the Python did), `wrap` (the row is a ring), `fixed` (off-grid neighbours are 0).
- The mask is expanded by **nearest neighbour** (each cell becomes a `cellPx x cellPx` block; the last block may be
  clipped by the image edge). No resampling filter (the Python used Lanczos, which smears a 0/1 image).

Two **spaces** (`CASpace`):
- `image`: the grid is laid over the picture (the mask pixel at `(x, y)` is cell `(x/cellPx, y/cellPx)`). Read along
  a sort line, the pattern is sheared at non-zero angles.
- `line`: the grid is laid over the *lines*: row = `lineIndex / cellPx`, column = `indexAlongLine / cellPx`. The
  pattern rotates with the sort. PLAN.md asked for both to be tried and compared.

---

### P4-T01 · The automaton

**Goal.** Generate CA rows and masks, deterministically.

**Files.** `engine/ca.go`, `engine/ca_test.go`, `engine/ca_prop_test.go`, `engine/ca_fuzz_test.go`.

**Spec.**

```go
type CABoundary string
const (CARandom CABoundary = "random"; CAWrap = "wrap"; CAFixed = "fixed")

// caRows runs rule for `rows` rows starting from `first` (len = width). Pure; no randomness; used by tests.
func caRows(first []uint8, rows int, rule uint8, b CABoundary, rng *RNG) [][]uint8

// CAGrid returns the cw x ch cell grid for a rule with a random first row from NewStream(seed, 0xCA000000|rule).
func CAGrid(cw, ch int, rule uint8, b CABoundary, seed uint32) [][]uint8

// CAMapImage expands the grid to a w*h mask in image space (nearest neighbour). 0 or 1 per pixel.
func CAMapImage(w, h, cellPx int, grid [][]uint8) []uint8
```

For `random` boundary, row `y >= 1` takes its two edge cells from `rng.Uint32n(2)` **before** computing the interior
(same order as the mockup: left edge, then right edge). Define the order in a comment and keep it.

**Tests first.**
- Known rows with a fixed boundary from `first = 0001000` (7 cells):
  - rule 90 (`new = left XOR right`): rows 1 to 3 are `0010100`, `0101010`, `1000001`.
  - rule 30 (`new = left XOR (centre OR right)`): rows 1 to 2 are `0011100`, `0110010`.
  - rule 110 (Wolfram table 111->0, 110->1, 101->1, 100->0, 011->1, 010->1, 001->1, 000->0): rows 1 to 2 are
    `0011000`, `0111000`.
  (All worked by hand and double-checked when this plan was written; if a test disagrees, re-derive before
  changing the expected row, and show the working in a comment.)
  - rule 0 gives all zeros after row 0; rule 255 gives all ones after row 0; rule 204 (identity) repeats the row.
- `wrap` vs `fixed` differ exactly at the edges for rule 90 from `1000000`.
- `TestCAGridDeterministic`: same `(rule, seed)` twice equal; different seed differs (for width >= 16).
- `TestCAMapImageNearest`: a 2x2 grid `[[1,0],[0,1]]`, `cellPx 3`, 5x5 image: hand-expanded map with the clipped last
  block.
- `TestProp_CAMapShape`: length `w*h`, values only 0 or 1, cell blocks constant inside a cell.
- `FuzzCARule(rule, w, h, cell, seed)`: clamp inputs, no panic, values 0/1, deterministic.

**Verify.** `go test ./engine -run 'CA' -race`; fuzz 10s.

**Commit.** `Add cellular automaton generator`

---

### P4-T02 · The two interval modes

**Goal.** Cut intervals with a CA mask. Remove `ErrNotImplemented`.

**Files.** `engine/intervals.go`, `engine/plan.go`, `engine/plan_ca_test.go`.

**Spec.** Along a run `[r0, r1)` (non-frozen pixels of a line) with `mask` = the CA mask in the **image space** for
now (line space is the next task):
- `ca`: cut before each pixel `u > r0` where `mask[P[u]] == 1` and `mask[P[u-1]] == 0` (the mask turns on). The pixel
  at `u` starts the new interval and takes part in it (a *cut*, not a *freeze*: PLAN.md 3.3).
- `ca-edges`: build `EdgeMap` of the mask scaled to 0/255, then cut at the first pixel of each run of edge pixels
  exactly like the `edges` mode, using the class's `Edge` threshold (a threshold of 0 cuts at every transition).
- Remove the `ErrNotImplemented` return and the `TestPlanCAReturnsNotImplemented` test.
- The CA is computed once per `(rule, cell)` pair actually used by any class, cached for the build.

**Tests first.**
- `TestPlanCACutsOnRisingEdge`: a 1-row image with a hand-made mask via a test hook (`caMaskOverride`, unexported,
  set only in tests, documented) cuts exactly where the mask rises.
- `TestPlanCAEdgesThresholdZero`: cuts at every transition.
- Extend `TestProp_PlanInvariants` and `TestProp_StepperEqualsSort` so `ParamsGen` can produce `ca` and `ca-edges`
  (remove the exclusions added in phases 1 and 3). All invariants still hold.
- `TestPlanCADeterministic`.

**Verify.** `go test ./engine -race -rapid.checks=500`.

**Commit.** `Add ca and ca-edges interval modes`

---

### P4-T03 · Line space

**Goal.** The alternative mask: the pattern rotates with the sort.

**Files.** `engine/ca.go`, `engine/intervals.go`, `engine/ca_line_test.go`.

**Spec.** When `CASpace == "line"`, the mask bit for the pixel at index `i` along line `l` is
`grid[min(ch-1, l/cellPx)][min(cw-1, i/cellPx)]`, where the grid is sized `cw = ceil(maxLineLength / cellPx)`,
`ch = ceil(numLines / cellPx)`. `i` is the index within the line (walking order), `l` the line's index in
`Plan.Lines`. Everything else (cuts, edges) is as in P4-T02.

**Tests first.**
- `TestCALineEqualsImageAtAngleZero`: with angle 0 on a `w x h` image, lines are rows in order and index along the
  line is `x`, so line space and image space masks are identical; the resulting intervals are equal. (Same for angle
  180 with the index reversed: assert the *set* of cut positions mirrors.)
- `TestCALineRotatesWithAngle`: at angle 90 on a square image, the line-space mask read along lines equals the
  image-space mask read along rows at angle 0 (the pattern turned with the sort).
- Properties from P4-T02 hold with `CASpace: line`.

**Verify.** `go test ./engine -run 'CA|Plan' -race`.

**Commit.** `Add line-space cellular automata`

---

### P4-T04 · Rule catalogue

**Goal.** The curated rules and their one-line characters, as data the UI will use.

**Files.** `engine/carules.go`, `engine/carules_test.go`.

**Spec.** Data lifted from the Python (`pixelsort/effects/special_effects.py` and the notes in
`pixelsort/ui/interface_components.py`), recorded here so nothing needs to be fetched:

```go
// RecommendedRules is the Python app's curated pool; "random" rule picks from it.
var RecommendedRules = [...]uint8{26, 19, 23, 25, 35, 106, 11, 110, 45, 41, 105, 54, 3, 15, 9, 154, 142}

// RuleNote is the one-line character of a recommended rule.
func RuleNote(rule uint8) (string, bool)
```

Notes (group notes apply to every rule in the group):

| Rules | Note |
|---|---|
| 26, 19, 23, 25 | Simple patterns with structure |
| 35, 106, 11 | More complex organised patterns |
| 110 | Turing complete, creates complex structures |
| 45, 41, 105 | Irregular but structured patterns |
| 54, 3, 15, 9 | Various geometric patterns |
| 154, 142 | Dense, fractal-like patterns |

`RuleNote` returns `("", false)` for any other rule. Add `func PickRecommended(seed uint32) uint8` that picks from
`RecommendedRules` using `NewStream(seed, 0xCA5E)` (this replaces the Python's `-1 means random`). The UI will
call it when the user chooses "surprise me"; the engine itself never picks a rule on its own (a recipe always
names its rule).

**Tests first.** Every recommended rule has a note; no duplicates in the pool; `PickRecommended` is deterministic and
over 1000 seeds hits every rule at least once; `RuleNote(1)` is `("", false)`.

**Verify.** `go test ./engine -run 'Rule' -race`.

**Commit.** `Add recommended CA rules`

---

### P4-T05 · Goldens, benchmarks, WASM

**Goal.** Pin CA behaviour on every platform.

**Files.** `engine/golden_test.go` (extend the table), `engine/testdata/golden/*`, `engine/ca_bench_test.go`.

**Spec.** Add recipes `ca-110-image` (97x61, angle 0), `ca-30-line` (97x61, angle 37, `CASpace line`),
`ca-edges-90-wrap` (61x97, angle 90, `CABoundary wrap`, edge 0), `ca-54-regions` (97x61 with the checker region map,
one class using CA at its own angle). Regenerate `recipes.json` (phase 2) if it exists. Benchmark
`BenchmarkCAGrid` and `BenchmarkNewPlanCA` at 8 MP. Run goldens under amd64 and, if phase 2 is done, WASM.

**Verify.** `go test ./engine -run Golden`; `GOARCH=amd64 go test ./engine -run Golden`; `make wasm-test`
(and `node web/scripts/wasm-golden.mjs` when phase 2 exists).

**Commit.** `Add CA goldens and benchmarks`

---

### P4-T06 · Phase wrap-up

`make check`, `make test`, `go test ./engine -rapid.checks=2000`, `make fuzz FUZZTIME=30s`. Add a paragraph to
`engine/README.md` on the two CA spaces. In `NOTES.md`, record a recommendation on which space should be the UI
default (PLAN.md P1 left it open): render one photo with each at a few angles to PNG (`render` command) and
describe, in two sentences, which looks better and why. Tick `PROGRESS.md`.

**Commit.** `Finish phase 4`
