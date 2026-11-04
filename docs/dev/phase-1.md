# Phase 1: the engine, native Go

**Goal.** The whole pure engine, tested to death on the native machine: image type, parameters, sort keys,
the scanline partition at any angle, intervals (every mode except cellular automata), regions plumbing, the
instant sorter, feather, goldens, fuzzing and a command that renders a PNG from a recipe.

**Spec sources.** `PLAN.md` sections 3.1 to 3.5 and 8; `decisions.md` E1 to E12; the working stand-in
`mockups/shared/demo-engine.js` (read it: `_partition`, `_lines`, `_build`, `_computeKeys`, `_sortInterval`
are the behaviours being rebuilt properly) and its tests `mockups/tests/engine-properties.mjs` and
`region-properties.mjs` (the properties below are those tests, widened).

**Verified starting point.** `reference/primitives.go.txt` and `reference/primitives_test.go.txt` contain the
RNG, the integer sine, the key formulas and the line partition, already proven on arm64, amd64 and WASM.
Tasks P1-T02, P1-T04 and P1-T05 start from them. Everything else in this phase is specified here but was not
pre-run: write the tests first and let them catch mistakes.

**Exit criteria.**
1. `go test ./engine/...` is green, including all properties, with `-race`.
2. `go test ./engine -rapid.checks=2000` is green.
3. Every fuzz target runs 30 seconds without a failure.
4. `go run ./cmd/pixelsort-go render --in x.png --recipe r.json --out y.png` produces a sorted PNG.
5. Golden hashes pass on the developer's machine and in CI (and later in WASM).
6. `go test ./engine -cover` reports at least 85%.

Branch: `build/phase-1`.

---

## The engine's shape (read before starting)

```
Image  ──►  NewPlan(img, params, options)  ──►  Plan  ──►  plan.Sort()      → *Image   (instant)
                                                       └──►  plan.NewStepper() → Stepper  (phase 3)
```

`NewPlan` does all the expensive thinking once: sort keys, the line partition, and the list of intervals.
Sorting is then a loop over intervals. A `Plan` is immutable after construction (the stepper copies what it
mutates).

```go
type Interval struct{ A, B int32 } // half-open range of indexes into Plan.Lines.P

type Options struct {
	Regions *Regions // nil = the whole image is one region
	Mask    []uint8  // len W*H or nil; non-zero = frozen (a hard barrier)
	Soft    []uint8  // len W*H or nil; alpha 0..255 blended back toward the original after sorting (feather)
}

type Stats struct{ Lines, Intervals, SortablePixels, FrozenPixels int }
```

Pixel layout: `Pix[i] = r | g<<8 | b<<16 | a<<24` (decision E1). Position `i = y*W + x`.

---

### P1-T01 · Image type

**Goal.** The pixel container and its conversions.

**Files.** `engine/image.go`, `engine/image_test.go`, `engine/image_fuzz_test.go`.

**Spec.**

```go
const MaxPixels = 1 << 28 // 16384 x 16384; larger images are refused

var ErrBadSize = errors.New("engine: image size out of range")
var ErrBadData = errors.New("engine: pixel data does not match image size")

type Image struct {
	W, H int
	Pix  []uint32 // len W*H
}

func NewImage(w, h int) (*Image, error)            // ErrBadSize if w<1, h<1 or w*h > MaxPixels (no overflow)
func FromRGBA(w, h int, rgba []byte) (*Image, error) // ErrBadSize or ErrBadData (len must be 4*w*h)
func (im *Image) RGBA() []byte                      // a copy, 4 bytes per pixel: r,g,b,a
func (im *Image) Clone() *Image
func Pack(r, g, b, a uint8) uint32
func Unpack(p uint32) (r, g, b, a uint8)
```

The size check must not overflow: test `w*h` as `w > MaxPixels/h`, never by multiplying first.

**Tests first.**
- Table: sizes `0x5`, `5x0`, `-1x3`, `1x1`, `MaxPixels x 1`, `MaxPixels+1 x 1`, `1<<31 x 1<<31` (no overflow panic).
- `Pack`/`Unpack` round trip for 8 hand-picked colours; `Pack(1,2,3,4) == 0x04030201`.
- `FromRGBA(RGBA())` is the identity; a wrong length returns `ErrBadData`.
- `TestProp_RGBARoundTrip` (rapid): random size up to 40x40, random bytes: `FromRGBA` then `RGBA` returns the same bytes.
- `FuzzFromRGBA(f *testing.F)`: arguments `(w, h int, data []byte)`, clamp `w`,`h` to `0..64` *without
  skipping*, never panic, and when it succeeds the round trip holds.

**Verify.** `go test ./engine -run 'Image|RGBA|Pack' -race`; `go test ./engine -run '^$' -fuzz FuzzFromRGBA -fuzztime=10s`.

**Commit.** `Add Image type and conversions`

---

### P1-T02 · RNG and integer helpers

**Goal.** SplitMix64 streams and the integer-only helpers (decisions E5, E6).

**Files.** `engine/rng.go`, `engine/fixed.go`, `engine/rng_test.go`, `engine/fixed_test.go`.

**Start from** the `RNG` section and `Sin1000`, `Lerp255` of `reference/primitives.go.txt`. Split into the two
files. Add `func (r *RNG) Float64() float64` **only if a test needs it; the engine itself must not** (rule 2).

**Tests first** (copy from `reference/primitives_test.go.txt`): `TestRNGVectors`, `TestSin1000`; add:
- `TestProp_Uint32nInRange`: for `n` in `1..1<<20` every draw is `< n`; `Uint32n(0) == 0`.
- `TestProp_StreamsDiffer`: `NewStream(s, a)` and `NewStream(s, b)` for `a != b` produce different first outputs
  (check 1000 pairs; collisions of a 64-bit value are not expected).
- `TestProp_SinRange`: `Sin1000` is within `[-1000, 1000]` for any `uint32`, and `Sin1000(p+65536) == Sin1000(p)`.
- `TestProp_Sin1000Antisymmetric`: `Sin1000(p + 32768) == -Sin1000(p)` for `p` in `0..32767`.
- `TestLerp255`: `Lerp255(p,q,0)==p`, `Lerp255(p,q,255)==q`, result between `p` and `q` for any inputs, and
  `Lerp255(0,255,128) == 128`.
- Rough uniformity (not a statistical suite): 100k draws of `Uint32n(10)` put between 9000 and 11000 in every bucket.

**Verify.** `go test ./engine -run 'RNG|Sin|Lerp|Uint32n|Stream' -race`.

**Commit.** `Add RNG and integer helpers`

---

### P1-T03 · Parameters

**Goal.** The recipe: one JSON-serialisable struct with defaults and strict validation.

**Files.** `engine/params.go`, `engine/params_test.go`, `engine/params_fuzz_test.go`.

**Spec.**

```go
type IntervalMode string
const (ModeRandom IntervalMode = "random"; ModeWave = "wave"; ModeThreshold = "threshold"; ModeEdges = "edges";
       ModeCA = "ca"; ModeCAEdges = "ca-edges"; ModeNone = "none")

type SortKey string
const (KeyLuma SortKey = "luma"; KeyValue = "value"; KeyIntensity = "intensity"; KeyMinimum = "minimum";
       KeyHue = "hue"; KeySaturation = "saturation"; KeyRed = "red"; KeyGreen = "green"; KeyBlue = "blue"; KeyAlpha = "alpha")

type Algo string
const (AlgoOddEven Algo = "oddeven"; AlgoInsertion = "insertion"; AlgoMerge = "merge"; AlgoReveal = "reveal")

type Params struct {
	Mode         IntervalMode `json:"mode"`
	Key          SortKey      `json:"key"`
	Reverse      bool         `json:"reverse"`      // descending
	Angle        int          `json:"angle"`        // whole degrees 0..359 (decision E3)
	Length       int          `json:"length"`       // mean interval length, per mille of image width, 1..1000
	Randomness   int          `json:"randomness"`   // percent of intervals left unsorted, 0..100
	WaveAmp      int          `json:"waveAmp"`      // 0..100
	WavePeriod   int          `json:"wavePeriod"`   // per mille of width, 0 = automatic, else 1..1000
	Lo           int          `json:"lo"`           // threshold band, 0..255, Lo <= Hi
	Hi           int          `json:"hi"`
	ThresholdKey SortKey      `json:"thresholdKey"` // which value the band applies to
	Edge         int          `json:"edge"`         // edge sensitivity: a pixel is an edge when |laplacian| > Edge, 0..255
	Rule         int          `json:"rule"`         // cellular automaton, Wolfram rule 0..255 (phase 4)
	Cell         int          `json:"cell"`         // CA cell size, per mille of width, 1..1000 (phase 4)
	CASpace      string       `json:"caSpace"`      // "image" | "line" (phase 4)
	CABoundary   string       `json:"caBoundary"`   // "random" | "wrap" | "fixed" (phase 4)
	Algo         Algo         `json:"algo"`
	Seed         uint32       `json:"seed"`
}

var ErrInvalidParams = errors.New("engine: invalid params")

func DefaultParams() Params
func (p Params) Validate() error          // wraps ErrInvalidParams; message names the field and the bad value
func ParseParams(data []byte) (Params, error) // starts from DefaultParams, decodes strictly, validates
func (p Params) With(c ClassDef) Params   // effective params for a region class (see below)
```

`DefaultParams()`: mode `random`, key `luma`, angle 0, length 83, randomness 10, waveAmp 70, wavePeriod 0,
lo 51, hi 209, thresholdKey `luma`, edge 26, rule 110, cell 8, caSpace `image`, caBoundary `random`, algo
`oddeven`, seed 7.

`ParseParams`: `json.NewDecoder` with `DisallowUnknownFields`, decoding **into a copy of `DefaultParams()`** so
missing fields keep their defaults; reject trailing data after the object; then `Validate`.

`ClassDef` (per-region overrides, used from P1-T06 on; every field optional, `nil` = inherit):

```go
type ClassDef struct {
	Frozen     bool          `json:"frozen,omitempty"`
	Angle      *int          `json:"angle,omitempty"`
	Key        *SortKey      `json:"key,omitempty"`
	Reverse    *bool         `json:"reverse,omitempty"`
	Mode       *IntervalMode `json:"mode,omitempty"`
	Length     *int          `json:"length,omitempty"`
	Randomness *int          `json:"randomness,omitempty"`
	Lo, Hi, Edge, Rule, Cell *int  // json tags lo, hi, edge, rule, cell, all omitempty
	Algo       *Algo         `json:"algo,omitempty"`
}
```

`With` copies `p`, replaces each field whose override is non-nil, and returns the result. It does not
validate (the caller validates the result).

**Tests first.**
- `TestDefaultParamsValid`: `DefaultParams().Validate() == nil`.
- Table `TestValidateRejects`: one row per field with a bad value (`angle -1`, `angle 360`, `length 0`, `length 1001`,
  `randomness 101`, `lo 200 hi 100`, `mode "bogus"`, `key ""`, `algo "quick"`, `edge 256`, `rule 256`, `cell 0`,
  `waveAmp 101`, `wavePeriod -1`, `caSpace "x"`). Each error `errors.Is(err, ErrInvalidParams)` and its text contains
  the field name.
- `TestParsePartialKeepsDefaults`: `{"angle":45}` gives `Angle 45` and every other field default.
- `TestParseRejectsUnknownField`, `TestParseRejectsTrailingData` (`{} {}`), `TestParseRejectsWrongType` (`{"angle":"x"}`).
- `TestWith`: overriding `Angle`, `Key` and `Length` changes exactly those; a zero `ClassDef` changes nothing.
- `TestProp_ParamsJSONRoundTrip` (rapid, using `testutil.ParamsGen`, see T07 note: write a local generator now and
  move it later): marshal then `ParseParams` returns an equal struct.
- `FuzzParamsJSON` (as in `testing.md`): seeds include valid, truncated, huge numbers, nested garbage; never panics;
  anything that parses validates and round-trips.

**Verify.** `go test ./engine -run 'Params|Validate|Parse|With' -race`; fuzz 10s.

**Commit.** `Add Params with validation and JSON`

---

### P1-T04 · Sort keys

**Goal.** Per-pixel sort keys as one byte each (decision E2).

**Files.** `engine/keys.go`, `engine/keys_test.go`, `engine/keys_fuzz_test.go`.

**Start from** `luma`, `hue`, `saturation` in `reference/primitives.go.txt`.

**Spec.**

```go
// KeyFunc maps a packed pixel to its key.
type KeyFunc func(p uint32) uint8

func KeyFor(k SortKey, reverse bool) KeyFunc // reverse returns 255 - key
func ComputeKeys(im *Image, k SortKey, reverse bool) []uint8 // convenience: one key per pixel
```

Formulas (decision E2): `luma = (299r+587g+114b)/1000`; `value = max`; `intensity = (r+g+b)/3`;
`minimum = min`; `saturation = max==0 ? 0 : (max-min)*255/max`; `hue` as in the reference (0..254);
`red/green/blue/alpha` = the channel. `KeyFor` panics only for an unknown key (programmer error: `Validate`
prevents it); say so in the comment.

**Tests first.**
- Colour table from the reference: for each of the 11 colours in `TestKeys`, `hue`, `saturation`, `luma`.
- Table for `value`, `intensity`, `minimum` and the four channels on `(10,200,30,255)` and `(200,100,50,128)`.
- `TestReverse`: for every key and 256 random pixels, `KeyFor(k,true)(p) == 255 - KeyFor(k,false)(p)`.
- `TestProp_KeyOrderingStable`: for any two pixels with equal `KeyFor(k,false)` the reversed keys are also equal
  (stability under reverse).
- `TestHueIsAColourWheel`: walking pure hues R→Y→G→C→B→M gives non-decreasing hue (`0,42,85,127,170,212`).
- `FuzzKeys`: any `uint32` pixel, any key, never panics, result in `0..255`.

**Verify.** `go test ./engine -run 'Key|Hue|Reverse' -race`.

**Commit.** `Add sort keys`

---

### P1-T05 · Line partition

**Goal.** Split the image into staircase lines at any whole-degree angle with no rotation (decision E3).

**Files.** `engine/lines.go`, `engine/lines_test.go`, `engine/lines_prop_test.go`, `engine/lines_fuzz_test.go`,
`engine/testdata/slopes.golden`.

**Start from** `axisFor`, `roundMul`, `Lines`, `Partition` in `reference/primitives.go.txt`.

**Spec.** Exactly the reference: `Partition(w, h, angle) Lines`. Angle rules (integer comparisons, never
floats): 0..45 and 315..359 walk x left to right; 135..225 walk x right to left; 46..134 walk y bottom to top;
226..314 walk y top to bottom. Slope is 16.16 fixed point from a once-per-angle float computation wrapped in
`float64()`.

**Tests first.** Copy `TestPartitionBijection`, `TestCardinalDirections`, `TestSlopeTable` from
`reference/primitives_test.go.txt`, then add:
- `TestProp_PartitionIsBijection` (rapid): `w,h` in `1..90`, angle `0..359`; length is `w*h`, each position once,
  `Starts` strictly increasing, last start equals `w*h`, every line non-empty.
- `TestProp_LinesAreConnected`: within a line, consecutive pixels are neighbours: `|dx|<=1` and `|dy|<=1` when
  the angle is a multiple of 45 or less steep than 45 (a staircase may step one pixel along the minor axis, never
  more). State the exact bound you assert in a comment.
- `TestSlopeTableGolden`: build `m16` for all 360 angles, format as `angle m16\n` lines, compare with
  `engine/testdata/slopes.golden` (create it with `-update` on the first run, then **review that the cardinal
  angles are 0 and 45/135/225/315 are +-65536**). This file is checked on arm64, amd64 and WASM; if a platform
  disagrees, fix the code, not the file.
- `TestAxisRulesAreIntegers`: for 0..359, `xMajor` and `sign` match the table in the spec above (hard-code the
  boundaries 0, 45, 46, 134, 135, 225, 226, 314, 315, 359).
- `FuzzPartition(w, h, angle int)`: clamp `w,h` to `1..48` and angle with `((a%360)+360)%360`, check the bijection.

**Verify.** `go test ./engine -run 'Partition|Cardinal|Slope|Axis|Lines' -race`; fuzz 10s.

**Commit.** `Add scanline partition for any angle`

---

### P1-T06 · Regions: types and region-aware lines

**Goal.** The region map and the partition that never lets a line cross a cell (decision E10; PLAN.md 3.4).

**Files.** `engine/regions.go`, `engine/regions_test.go`, `engine/regions_prop_test.go`.

**Spec.**

```go
type Regions struct {
	Labels  []uint16  // len W*H: cell id per pixel; 0 = between shapes
	ClassOf []uint8   // indexed by cell id: the class of that cell; cell 0 is class 0
	Defs    []ClassDef // indexed by class id
}

var ErrBadRegions = errors.New("engine: invalid regions")
func (r *Regions) Validate(w, h int) error // len(Labels)==w*h; every label < len(ClassOf); every class < len(Defs)
func (r *Regions) classes(w, h int) []uint8 // per-pixel class (internal)

// PartitionRegions is Partition for a region map. Each class is walked at its own angle (Defs[c].Angle, else the
// default). Lines are cut wherever the cell changes or a pixel of another class interrupts the walk. Every pixel is
// still in exactly one line.
func PartitionRegions(w, h, defaultAngle int, r *Regions) Lines
```

Algorithm (port of `_lines` in the mockup, with one fix: **iterate the angle groups in ascending angle order**,
because Go's map order is random and determinism rule 3 forbids it):

1. `cls = r.classes(w,h)`. `used` = the set of classes that occur. Group classes by their effective angle.
2. For each angle ascending: `part := Partition(w,h,angle)`. For each line of `part`: `open := false`, `prev := 0`.
   For each pixel `pos` on it: if `cls[pos]` is not in this angle's class set, set `open = false` and continue.
   Otherwise, if `open` and `labels[pos] != prev`, set `open = false`. If not `open`, start a new line (append to
   `Starts`) and set `open = true`. Append `pos`; `prev = labels[pos]`.
3. Append the final start.

If `r == nil`, `PartitionRegions` equals `Partition`.

**Tests first.**
- `TestPartitionRegionsNilEqualsPartition`.
- Hand case: a 6x1 image, labels `0 1 1 2 2 2`, all class 1 at angle 0: lines are `[1 2]`, `[3 4 5]`, and `[0]`
  as its own line (class 0). State the expected `P` and `Starts`, computed by hand in the test comment.
- `TestPartitionRegionsAngleGroupsAscending`: two classes at angles 100 and 20: lines for angle 20 come first.
- `TestValidateRegions`: wrong label length, label out of range, class out of range each give `ErrBadRegions`.
- `TestProp_RegionPartition` (rapid, `testutil.RegionsGen`): total pixels `w*h`, no duplicates (bijection);
  every line lies inside one cell; every line holds a single class.
- Port the 56-configuration idea from `mockups/tests/region-properties.mjs`: for 7 shapes x 4 patterns the real
  tessellations arrive in phase 7, so for now generate cell maps with `testutil.GridCells(w, h, size)` (a plain grid
  of square cells) and `testutil.ClassPattern(cells, "checker"|"thirds"|"all"|"random", seed)`.

**Verify.** `go test ./engine -run 'Region' -race`.

**Commit.** `Add regions and region-aware lines`

---

### P1-T07 · Test helpers and generators

**Goal.** One definition of "a random valid input", reused by every property and fuzz test.

**Files.** `internal/testutil/gen.go`, `internal/testutil/golden.go`, `internal/testutil/gen_test.go`.
Add the dependency: `go get pgregory.net/rapid@latest && go mod tidy`.

**Spec.**

```go
func Gradient(w, h int, seed uint32) *engine.Image          // integer-only, identical everywhere
func ImageGen(maxW, maxH int) *rapid.Generator[*engine.Image] // few colours, so key ties are common
func ParamsGen() *rapid.Generator[engine.Params]               // every field valid and varied
func RegionsGen(w, h int) *rapid.Generator[*engine.Regions]    // grid cells, 1..4 classes, random defs
func GridCells(w, h, size int) []uint16
func ClassPattern(cells int, pattern string, seed uint32) []uint8
func Golden(t testing.TB, name string, got []byte)             // compares sha256 hex with testdata/golden/<name>.sha256; `-update` rewrites
func UniqueIDImage(w, h int) *engine.Image // pixel i has r = i%7 (many ties), g = i&255, b = i>>8 : identity recoverable
```

`Gradient`: for pixel `(x,y)`, `r = (x*255/max(1,w-1) + int(seed)*7) & 255`, `g = (y*255/max(1,h-1) + int(seed)*13) & 255`,
`b = ((x ^ y) * 5 + int(seed)) & 255`, `a = 255`. No floats.

`ImageGen`: draw `w` in `1..maxW`, `h` in `1..maxH`, a palette of 1..8 random colours, then each pixel is a palette
index (`rapid.IntRange(0, n-1)`). Using `rapid.SliceOfN` for `w*h` pixels is fine at these sizes.

`Golden`: the `-update` flag is a package-level `flag.Bool("update", ...)`; `Golden` writes or compares
`sha256.Sum256(got)` as hex plus newline; on mismatch prints both hashes.

**Tests first.** `Gradient` known values: `Gradient(3,2,0)` pixels (compute by hand and write them out);
`ParamsGen` always produces `Validate() == nil` (rapid, 500 checks); `RegionsGen` output passes `Validate`;
`UniqueIDImage` ids are unique within 65536 pixels.

**Verify.** `go test ./internal/... -race`.

**Commit.** `Add test generators and golden helper`

---

### P1-T08 · Edge map

**Goal.** The 3x3 Laplacian used by `edges` intervals (decision E7).

**Files.** `engine/edges.go`, `engine/edges_test.go`.

**Spec.**

```go
// EdgeMap returns |8*c - sum(8 neighbours)| clamped to 255 for each pixel of a luma plane, with out-of-image
// neighbours replaced by the nearest edge pixel (replication).
func EdgeMap(luma []uint8, w, h int) []uint8
```

**Tests first.**
- Flat image (all 100): all zeros.
- A single bright pixel (200) on black 3x3 centre: centre value `min(255, 8*200)=255`; each neighbour
  `|0*8 - (200 + 0*7)| = 200`; corners of the 3x3 are also neighbours of the centre: state the full expected 3x3.
- 1x1 image: `[0]` (every neighbour is itself, `8c - 8c = 0`).
- `1xN` vertical step edge: values hand-computed for `[0,0,255,255]` with replication: `[0, 255, 255, 0]`
  (derive and assert; if your arithmetic differs, fix the test with the working shown in a comment).
- `TestProp_EdgeMapRange`: any luma plane, no panic, length `w*h`.

**Verify.** `go test ./engine -run Edge -race`.

**Commit.** `Add Laplacian edge map`

---

### P1-T09 · Plan: keys, lines and intervals

**Goal.** `NewPlan`: the one place that turns an image and a recipe into a list of intervals to sort
(decisions E7, E10).

**Files.** `engine/plan.go`, `engine/intervals.go`, `engine/plan_test.go`, `engine/plan_prop_test.go`.

**Spec.**

```go
var ErrNotImplemented = errors.New("engine: not implemented yet") // ca / ca-edges until phase 4

type Plan struct {
	W, H      int
	Orig      []uint32 // the input pixels (not copied; the Plan never mutates them)
	Keys      []uint8  // per pixel position
	Lines     Lines
	Intervals []Interval
	Algos     []Algo   // per interval (from its class's effective params)
	Stats     Stats
	soft      []uint8
}

func NewPlan(im *Image, p Params, o *Options) (*Plan, error)
```

Steps, in order:

1. `p.Validate()`; validate `o.Mask` (`len == W*H`), `o.Soft` (same) and `o.Regions` (`Validate(W,H)`).
2. `cls := regions.classes()` (nil if no regions). Per class, `eff[c] = p.With(Defs[c])`, validated. A class
   not listed in `Defs` uses `p`.
3. Keys: for each pixel, `KeyFor(eff[cls[i]].Key, eff[cls[i]].Reverse)(Orig[i])` (class 0 when no regions).
4. `thr`: `KeyFor(p.ThresholdKey,false)` per pixel. `lum`: luma per pixel; `edge := EdgeMap(lum, W, H)` computed
   **only if some class uses `edges`**.
5. If any effective mode is `ca` or `ca-edges`: return `ErrNotImplemented` (removed in phase 4).
6. `Lines = PartitionRegions(W,H,p.Angle,regions)` (equals `Partition` when no regions).
7. A pixel is **frozen** when `Mask[pos] != 0`, or `eff[cls].Frozen`, or `eff[cls].Mode == threshold` and `thr[pos]`
   is outside `[Lo, Hi]` (inclusive).
8. For each line `l` (its index is the RNG stream id): `rng := NewStream(p.Seed, uint32(l))`. Walk the line; for
   each maximal run `[r0, r1)` of non-frozen pixels use the effective params of the class at the run's first pixel
   and cut it into segments:
   - `random`: from `c = r0`: `wd = max(2, Uint32n(2*mean+1))`, segment `[c, min(r1, c+wd))`, `c +=` its length.
   - `wave`: as decision E7 (`Sin1000`, `phase = (pos*65536/periodPx + l*11) & 0xFFFF`, `pos = c - lineStart`).
   - `edges`: cut before each pixel `u > r0` whose `edge[P[..u]] > Edge` and whose predecessor's is not.
   - `none`, `threshold`: one segment `[r0, r1)`.
   - (`mean = max(3, pixels(Length, W))`, `pixels(v, W) = max(1, (W*v+500)/1000)`.)
9. For each segment of length `>= 2`: draw `rng.Uint32n(10000)`; if it is `< Randomness*100`, skip it; else record
   `Interval{A: lineStart+a0, B: lineStart+a1}` and its algo. **Draw only for segments of length >= 2** (so the draw
   order is stable and matches this text).
10. `Stats`: lines, intervals, sortable pixels (sum of interval lengths), frozen pixels (count).

**Tests first** (hand-checkable first, then properties):
- `TestPlanNoneMode`: 4x2 gradient, mode `none`, angle 0, randomness 0: 2 lines, 2 intervals, each of length 4.
- `TestPlanRandomnessBounds`: randomness 100 gives zero intervals; randomness 0 sorts every segment.
- `TestPlanThresholdFreezes`: image row `[10, 100, 100, 250, 100]` luma-ish via `KeyRed` threshold key with `Lo=50,
  Hi=200`: frozen at positions 0 and 3; intervals are `[1,3)` and `[4,5)` filtered to length >= 2 so only `[1,3)`.
- `TestPlanMaskFreezes`: a mask pixel in the middle splits the run in two.
- `TestPlanEdgesCutsAtFirstEdgePixel`: a hand-built plane with a two-pixel edge run cuts once, at its first pixel.
- `TestPlanRandomMeanLength`: over a 600x40 image, mode `random`, length 50 per mille (so 30 px), randomness 0,
  the mean interval length is within 15% of 30 (the mean really is the mean).
- `TestPlanDeterministic`: same inputs twice give equal `Intervals`; changing `Seed` changes them.
- `TestPlanIndependentOfOtherLines`: the intervals of line `l` do not change when the image is made taller
  (stream per line). Compare the first line of a 40x10 and a 40x20 image at angle 0.
- `TestPlanCAReturnsNotImplemented` (deleted in phase 4).
- `TestProp_PlanInvariants` (rapid, `ImageGen`, `ParamsGen` without CA modes, optional `RegionsGen`/mask): intervals
  lie inside lines, never overlap each other, never contain a frozen pixel, never span two cells, and have length
  `>= 2`; `Stats` agree with the lists.
- `TestPlanRegionOverrides`: class 1 frozen: none of its pixels appear in any interval; class 2 with `Angle`
  override gets its own lines.

**Verify.** `go test ./engine -run Plan -race`.

**Commit.** `Add Plan with intervals and freeze rules`

---

### P1-T10 · The instant sorter

**Goal.** Sort every interval, stably, and return the result (decision E8).

**Files.** `engine/sorter.go`, `engine/sorter_test.go`, `engine/sorter_prop_test.go`, `engine/sorter_fuzz_test.go`.

**Spec.**

```go
// Sort applies the plan and returns a new image. The Plan's own data is untouched, so Sort can be called
// repeatedly and always returns the same result.
func (pl *Plan) Sort() *Image
```

For each interval `[A,B)`: positions `P[A:B]`. Compute the stable ascending order of those positions by
`Keys[pos]`: if the interval has fewer than 32 pixels use insertion sort on an index slice; otherwise a counting
sort over the 256 keys (count, prefix sums, stable placement from the front). Then
`dst.Pix[P[A+j]] = Orig[P[A+order[j]]]`. Non-interval pixels are copied from `Orig`. Finally, if `soft != nil`,
blend each channel: `out = Lerp255(sorted, orig, soft[i])`.

Reuse one scratch slice sized to the longest interval; do not allocate per interval.

**Tests first.**
- `TestSortKnown`: row `[30,10,20]` (red channel = value) with mode `none`, key red, randomness 0: `[10,20,30]`.
- `TestSortReverse`: same with `Reverse`: `[30,20,10]`.
- `TestSortStableTies`: `UniqueIDImage` with `KeyRed`: equal-red pixels keep their original relative order.
- `TestSortDoesNotMutate`: `Orig` is unchanged after `Sort`; two `Sort()` calls are equal.
- `TestProp_Permutation` (property 2): sorted multiset equals input multiset (sort both as `[]uint32`).
- `TestProp_IntervalsSorted` (property 1): along each interval, keys are non-decreasing (recompute keys from the
  output pixels with the class's `KeyFor`; with regions use the class's key).
- `TestProp_FrozenNeverMove` (property 3): every pixel that is frozen (mask, frozen class, threshold) is unchanged.
- `TestProp_Deterministic` (property 4): `Sort()` twice from two separately built plans with equal inputs.
- `TestProp_OracleSliceStable` (property 8): for every interval, the output equals `sort.SliceStable` over the
  `(key, pixel)` pairs of the interval. Both the < 32 and >= 32 paths must be exercised (make the generator
  produce long lines; assert in the test that at least one interval was >= 32 across the run).
- `TestProp_RegionBoundaries` (property 7): with a region map, no interval contains two cell ids.
- `TestSoftBlend`: `Soft` all 255 returns the original image; all 0 returns the pure sort; 128 is between.
- `FuzzPlanAndSort(w, h, angle, mode, length, randomness, seed int64...)`: build params by clamping (no skipping),
  small image (`<= 40x40`), run `NewPlan` and `Sort`; the output is a permutation of the input and frozen
  pixels did not move; never panics.

**Verify.** `go test ./engine -run 'Sort|Prop_' -race -rapid.checks=500`; fuzz 20s.

**Commit.** `Add stable instant sorter`

---

### P1-T11 · Feather

**Goal.** Soft masks: a blurred alpha that blends the sorted result back toward the original (decision E11).

**Files.** `engine/feather.go`, `engine/feather_test.go`.

**Spec.**

```go
// Feather returns an alpha plane: the hard mask (non-zero = 255) blurred with a separable box filter of the
// given radius in pixels (window 2r+1, edges replicated), rounded to nearest. radius <= 0 returns the hard mask.
func Feather(mask []uint8, w, h, radius int) []uint8
```

Horizontal pass, then vertical pass, integer arithmetic only: `(sum + n/2) / n` with `n = 2*radius+1`. A sliding
window keeps it O(w*h). The result is the `Soft` option.

**Tests first.**
- Radius 0 gives 0/255 exactly. All-zero mask stays zero; all-255 stays 255 (for any radius, including a radius
  larger than the image).
- A single masked pixel (255) at the centre of a 5x5, radius 1, `n = 3`. Horizontal pass: the middle row becomes
  `[0,85,85,85,0]` (`(255+1)/3 = 85`). Vertical pass, on each of columns 1 to 3 (one `85` among zeros): rows 1 to 3
  become `(85+1)/3 = 28`. So the result is a 3x3 block of `28` in the middle of a 5x5 of zeros. Assert exactly that,
  with this working in a comment.
- `TestProp_FeatherRange`: output length `w*h`, symmetric under mirroring a symmetric mask.
- `TestProp_FeatherMonotoneMean`: the sum of the output is within `w*h` of the sum of the input (blur preserves
  mass up to rounding).

**Verify.** `go test ./engine -run Feather -race`.

**Commit.** `Add feather blur`

---

### P1-T12 · Goldens, benchmarks and the cross-platform check

**Goal.** Pin the engine's exact behaviour and make drift loud.

**Files.** `engine/golden_test.go`, `engine/bench_test.go`, `engine/testdata/golden/*.sha256`.

**Spec.** A table of recipes (name, params, size) run on `testutil.Gradient(w, h, 3)` and hashed over
`Sort().RGBA()`:

| name | size | notes |
|---|---|---|
| `random-0` | 97x61 | defaults, seed 1 |
| `random-45` | 97x61 | angle 45, length 60, seed 2 |
| `random-217` | 97x61 | angle 217, key hue, reverse |
| `wave-30` | 97x61 | mode wave, angle 30, waveAmp 70 |
| `threshold-90` | 97x61 | mode threshold, angle 90, lo 60, hi 200 |
| `edges-0` | 97x61 | mode edges, edge 30 |
| `none-270` | 61x97 | mode none, angle 270, key saturation |
| `regions-checker` | 97x61 | `GridCells(…, 16)`, `ClassPattern checker`, class 1 frozen, class 2 angle 100 key hue |
| `tiny-1x40` | 1x40 | any mode |
| `tiny-40x1` | 40x1 | any mode |

Create the goldens with `go test ./engine -run Golden -update`, then **read them**: they are SHA-256 lines, so
sanity-check by also writing one PNG per recipe to a temp dir during the update run and looking at two of them.

Benchmarks (`bench_test.go`): `BenchmarkNewPlan`, `BenchmarkSort`, each at 1, 2, 8 and 24 megapixels
(`Gradient` as input; build the image outside the timed region).

**Cross-platform.** After creating the goldens on one machine, run `GOARCH=amd64 go test ./engine -run Golden`
(works on an arm64 Mac under Rosetta) and, once phase 2 exists, in WASM. All must pass with the **same** files.

**Tests.** The golden test itself; plus `TestGoldenCoversEveryMode` (the table contains each of `random`, `wave`,
`threshold`, `edges`, `none`, and a regions case).

**Verify.** `go test ./engine -run Golden`; `GOARCH=amd64 go test ./engine -run Golden`; `make bench` runs.

**Commit.** `Add golden hashes and benchmarks`

---

### P1-T13 · The render command

**Goal.** Render a PNG from a recipe without any UI (the phase's visible deliverable).

**Files.** `cmd/pixelsort-go/render.go`, `cmd/pixelsort-go/render_test.go`.

**Spec.** `pixelsort-go render --in photo.png --recipe recipe.json --out sorted.png [--mask mask.png]`.
Decode the input with `image/png` or `image/jpeg` (`image.Decode`), convert to `engine.Image` (non-premultiplied
`NRGBA`), `ParseParams` the recipe file (a missing file or bad JSON is an error with the file name in it), `NewPlan`,
`Sort`, encode to PNG. `--mask` is an optional greyscale or alpha PNG: non-zero = frozen. Print the stats
(`lines`, `intervals`, `sortable`, `frozen`) to stdout.

**Tests first.** Build a small PNG in a temp dir, a recipe `{"mode":"none","key":"red","randomness":0}`, run the
command through `newRoot()` with `SetArgs`, then decode the output: it has the same size, and each row is sorted
by red. Also: missing input file, bad recipe, unknown flag each return an error.

**Verify.** `go test ./cmd/...`; run it by hand on a real photo and look at the result.

**Commit.** `Add render command`

---

### P1-T14 · Phase wrap-up

**Goal.** Everything green, documented, ticked.

**Steps.** Run `make check`, `make test`, `go test ./engine -rapid.checks=2000`, `make fuzz FUZZTIME=30s`,
`go test ./engine -cover` (>= 85%). Fix what fails (new tests for any bug found). Update `PROGRESS.md`. Add a
short `engine/README.md` describing `NewPlan`, `Sort` and the determinism rules in ten lines. Record anything
surprising in `NOTES.md`.

**Commit.** `Finish phase 1`
