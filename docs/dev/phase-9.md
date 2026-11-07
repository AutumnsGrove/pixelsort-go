# Phase 9: polish and stretch

These are the "later" items of `PLAN.md` section 4. They are **optional and independent**: each task stands alone,
none blocks another, and Autumn picks which to build and in what order. Each is written as a short brief with an
acceptance test, not a step-by-step recipe (more detail gets written when one is chosen, using the same format as
the earlier phases).

**Depends on.** Phases 1 to 8 done.

Branch per task: `build/p9-<name>`.

---

### P9-T01 · Worker pool (parallel sort)

**Goal.** Use all cores in the browser: a pool of Web Workers, each owning a band of lines.
**Why it is hard.** Go's WASM is single-threaded; real parallelism needs one module instance per worker and a shared pixel buffer
(`SharedArrayBuffer`, which needs the COOP/COEP headers the server already sends).
**Spec.** Partition `Plan.Lines` into N contiguous bands (the plan makes this cheap: lines are independent). Each worker builds the
plan for its band only and sorts into a shared output buffer. Falls back to the single worker when `crossOriginIsolated` is false.
**Acceptance.** Output **byte-identical** to the single-worker result for every golden recipe and for random recipes
(`web/scripts/pool-equals-single.mjs`); at 24 MP on a 4-core machine at least 2.5x faster for the instant sort; the stepper still ends
on the instant result.

### P9-T02 · Video recording of the animation

**Goal.** Save the animation as a video in the gallery.
**Superseded by [`animation-export.md`](animation-export.md)** (offline frame-by-frame render; GIF, MP4/WebM and APNG; CLI support). The spec below is kept for history.
**Spec.** `canvas.captureStream()` plus `MediaRecorder` to WebM while animating; stored as `kind = 'video'` (the schema and `video_id`
already exist); the Archive viewer plays it; the share album can include it (opt-in, size-capped).
**Acceptance.** A recorded animation plays back in the viewer; the video is deleted when its run is permanently deleted (blob GC);
a size cap stops recording with a clear message.

### P9-T03 · Scrubbing and rewind

**Goal.** Drag a slider through the sort.
**Spec.** Deterministic replay (PLAN.md 3.7): reset to the original and run N passes, never storing a frame per step. Add
`Session.Seek(pass int)`; the UI slider seeks with latest-wins. Cache a few checkpoints (every ~64 passes) at working resolution only if
measurement shows seeking is too slow.
**Acceptance.** `Seek(n)` pixels equal stepping `n` passes from the start (property test, all algorithms); the UI slider reaches any pass
under 300 ms at 2 MP.

### P9-T04 · More segmentations

**Goal.** Stars, pentagons, ellipses, and content-adaptive segmentation.
**Spec.** Extend `shapes.Tiling` with `star`, `pentagon`, `ellipse` (the mockup's "later" list); content-adaptive: a Voronoi whose sites are
biased toward high edge density (use `EdgeMap`, sample sites with the engine RNG proportional to edge strength).
**Acceptance.** The phase 7 properties hold for the new shapes; goldens added; the new shapes appear in the tiles.

### P9-T05 · Mask morphology and multiple mask layers

**Goal.** Erode and dilate masks; several named layers (soft, hard, inverted).
**Spec.** `masks.Erode/Dilate(mask, radius)` (integer, separable); `masks.Spec` gains `Layers`; the Protect panel lists layers with visibility and order.
**Acceptance.** Erode then dilate of a convex shape never grows it; layers compose in order; all mask tests still pass.

### P9-T06 · Batch processing

**Goal.** Apply one recipe to many pictures.
**Spec.** A batch dialog: choose files, pick a recipe (current or a preset), run them one at a time through the worker, save each as a run, download a zip
(store the zip with a tiny hand-written writer or `fflate`). Honour device limits per picture.
**Acceptance.** 10 mixed-size pictures produce 10 runs; one oversized picture is skipped with the catalog message and the rest finish.

### P9-T07 · Project export and import, shareable recipe links

**Goal.** Move a look between machines.
**Spec.** Export a recipe (params, tiling, mask spec, preset name) as a small JSON file; import it. A "copy recipe link" puts the recipe,
base64url encoded, in the URL fragment (never sent to a server); opening it applies the recipe to whatever picture is loaded. Validate on import
(the same validators as the engine params and `masks.Spec`).
**Acceptance.** Round trip equals the original; a damaged or hostile file is rejected with a catalog message and changes nothing; fragment
links over 8 KB are refused with a message.

### P9-T08 · TinyGo experiment

**Goal.** Decide with numbers whether TinyGo is worth it.
**Spec.** Build `cmd/wasm` with TinyGo if it compiles (it may not: it needs `syscall/js` support and reflection limits; stop and record that if not).
Compare binary size, startup time, and per-pass cost against standard Go using `web/scripts/bench*.mjs`; check the goldens still match.
**Acceptance.** `docs/perf.md` gains a comparison table and a one-line recommendation. No change to the default build unless the numbers are
clearly better and the goldens match.

### P9-T09 · Detail / coarseness control

**Goal.** "Smaller image, chunkier effect" as an explicit control (PLAN.md 3.8) instead of a side effect of working resolution.
**Spec.** A `Detail` parameter that downsamples the keys and cuts (not the picture) by an integer factor `1..8`: intervals and keys computed on a
coarser grid and applied to blocks of pixels. Needs a design decision first: write the proposal in `NOTES.md` and wait for Autumn.
**Acceptance.** Defined once designed.

### P9-T10 · Polish pass

**Goal.** A last review of everything for rough edges.
**Spec.** Run a full accessibility and keyboard audit (every control reachable, no keyboard traps, focus returns after dialogs), re-measure performance on
a real phone (**[HUMAN]** supplies numbers), review error messages for tone, delete dead code, make sure `docs/` matches the code, and refresh the
screenshots in `README.md`.
**Acceptance.** `NOTES.md` has a short report of what was found and fixed.
