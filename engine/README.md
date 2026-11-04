# engine

The pixel sorter itself. Pure Go: no I/O, no globals, no `syscall/js`, standard library only (plus `rapid` in tests).
It is a function of its inputs, so the same recipe gives the same bytes everywhere.

```go
im, err := engine.FromRGBA(w, h, rgba)   // or NewImage + Pix
p, err := engine.ParseParams(recipeJSON) // or engine.DefaultParams()
plan, err := engine.NewPlan(im, p, &engine.Options{Regions: r, Mask: m, Soft: soft})
sorted := plan.Sort()                    // a new *Image; the plan is untouched
```

`NewPlan` does the expensive thinking once: per-pixel keys, the line partition at any angle, and the intervals to
sort. A `Plan` is immutable, so `Sort` can run again and again (that is how a live preview stays cheap).
`plan.Stats` says how many lines, intervals, sortable and frozen pixels a recipe produced.

## Determinism rules (these are what make goldens portable)

1. Randomness is `RNG` (SplitMix64), one stream per line, seeded by `(recipe seed, line number)`. Never `math/rand`,
   never the clock. A line's intervals cannot change because the image got taller.
2. Nothing that decides *where a pixel goes* uses floating point. The single exception is the slope table, computed
   once per angle with explicit `float64()` conversions (arm64 would otherwise fuse a multiply-add), and pinned by
   `testdata/slopes.golden` on arm64, amd64 and WASM.
3. No map iteration order and no goroutine scheduling reaches the output: iterate slices, or sort map keys.

`testdata/golden/*.sha256` pin ten recipes. A changed hash is a behaviour change: bump `EngineVersion` in the same
commit and explain why, or find the bug.

## Files

`image.go` pixels · `params.go` the recipe · `keys.go` sort keys · `lines.go` the scanline partition ·
`regions.go` cells and classes · `intervals.go` and `plan.go` cutting · `sorter.go` the instant stable sort ·
`edges.go` the Laplacian map · `feather.go` the soft-mask blur. The stepper (phase 3) and cellular automata
(phase 4) are not here yet.

## Cellular-automaton intervals (`ca`, `ca-edges`)

An elementary CA (Wolfram rule 0..255) makes a 0/1 mask, and a new interval starts wherever the mask turns on along a
sort line (`ca`) or at the edges of the mask (`ca-edges`). The grid has cells of `Cell` per mille of the width, its
first row is random from `NewStream(seed, 0xCA000000|rule)`, and each row comes from the one above by the rule, with
`CABoundary` deciding the ends (`random`, `wrap`, `fixed`). The mask is expanded by nearest neighbour.

There are two places to lay the grid (`CASpace`):

- **`image`**: over the picture. Read along a sort line at an angle, the pattern is sheared into slanted slivers.
- **`line`**: over the sort lines (row = line number, column = index along the line), so the pattern turns with the
  sort and stays blocky and aligned with the direction of the streaks. At angle 0 the two are identical.
