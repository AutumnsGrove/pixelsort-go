# Phase 3: watch the sort happen

**Goal.** The stepper: the same sort as phase 1, but advanced a few steps at a time on one live buffer, so the
canvas shows pixels moving into place. Stable algorithms only, so the last frame is **identical** to the instant
result. This is the headline feature of the project.

**Spec sources.** `PLAN.md` 3.7; `decisions.md` E9; the mockup's `step()` and `_sortInterval()` in
`mockups/shared/demo-engine.js` (three algorithm families run side by side, one pass at a time); the mockup test
`mockups/tests/region-algo.mjs` (any mix of algorithms ends on the instant result).

**Exit criteria.**
1. For every algorithm x interval mode x angle (and with regions and masks), stepping to completion equals
   `Sort()` byte for byte.
2. After every single step the live image is a permutation of the input and frozen pixels have not moved.
3. The lab page has an Animate button; watching a sort in the browser works and ends on the instant result.
4. Per-pass cost is measured at 1, 2, 8 and 24 MP and recorded in `docs/perf.md`.

Branch: `build/phase-3`.

---

## The model

A `Stepper` owns a copy of the pixels (`live`) and of the keys (`keys`, because a key travels with its pixel)
and walks the plan's intervals. One `Step()` is one **pass**; each interval advances according to its own
algorithm, and the families run side by side (decision E9).

```go
type Stepper struct { /* plan, live []uint32, keys []uint8, per-family state, pass int, done bool */ }

func (pl *Plan) NewStepper() *Stepper
func (s *Stepper) Step() (done bool)   // one pass for every interval; returns true once everything is sorted
func (s *Stepper) Done() bool
func (s *Stepper) Pass() int
func (s *Stepper) Progress() float64   // 0..1, never decreases, exactly 1 when Done
func (s *Stepper) Image() *Image       // the live buffer wrapped, NOT a copy; valid until the next Step
func (s *Stepper) Result() *Image      // after Done: the live buffer with the plan's Soft blend applied (a copy)
```

`Image()` shows what the canvas should show *now*. If the plan has a `Soft` alpha plane, `Image()` applies the
same blend on the fly into a scratch buffer so the preview and the final result agree (document that it then
returns the scratch buffer).

Stability is the whole point: **every algorithm below only ever swaps or moves a pixel when its key is strictly
greater than the next one's**, so equal keys keep their order and the final result matches the stable counting
sort of phase 1.

---

### P3-T01 · Stepper skeleton and odd-even transposition

**Goal.** The first algorithm and the type around it.

**Files.** `engine/stepper.go`, `engine/stepper_oddeven.go`, `engine/stepper_test.go`, `engine/stepper_prop_test.go`.

**Spec (odd-even).** Per interval `[a0, a1)` (indexes into `Lines.P`), with `par = pass & 1`: for
`t = a0 + ((a0 ^ par) & 1); t+1 < a1; t += 2`: let `a = P[t]`, `b = P[t+1]`; if `keys[a] > keys[b]` swap both
`live[a],live[b]` and `keys[a],keys[b]` and count a swap. The sort is finished when **two consecutive passes
made no swaps** (an odd pass and an even pass both quiet). Termination bound: an interval of length `n` is
sorted after at most `n` passes, so `Step` must report done after at most `maxLen + 2` passes.

Only odd-even is implemented in this task; an interval whose algo is another one is treated as odd-even until its
own task (a temporary `// TODO(P3-T02):` is allowed here and must be gone by P3-T05).

**Tests first.**
- `TestStepperOddEvenKnown`: a 5x1 image, keys `[5,4,3,2,1]` (red channel), mode `none`: after pass 1 and 2 the
  hand-computed intermediate states (write them out: odd-even on a reversed list of five), and the final
  `[1,2,3,4,5]`.
- `TestStepperEqualsSortSmall`: 3 images (97x61, 1x40, 40x1) x angles `{0,30,45,90,135,217,300}` x modes
  `{random, wave, threshold, edges, none}`: loop `Step()` until done (guard `maxLen+5` passes), compare
  `Result().Pix` with `plan.Sort().Pix`.
- `TestProp_StepperEqualsSort` (rapid, `ImageGen`, `ParamsGen` without `ca*`, optional regions and mask):
  property 5.
- `TestProp_EveryPassIsAPermutation`: after **each** `Step()`, the multiset of `Image().Pix` equals the input's
  (sort both as slices and compare; use small images).
- `TestProp_FrozenNeverMoveDuringSteps`: after each `Step()`, every frozen position holds its original pixel.
- `TestStepAfterDoneIsNoop`: further `Step()` calls return true and change nothing.
- `TestPassBound`: `Pass() <= maxLen+2` at completion.

**Verify.** `go test ./engine -run 'Stepper' -race`.

**Commit.** `Add stepper with odd-even transposition`

---

### P3-T02 · Insertion

**Goal.** The classic streak: each pass inserts the next element.

**Files.** `engine/stepper_insertion.go`, tests added to the stepper test files.

**Spec.** Per interval keep a cursor `cur` starting at `a0+1`. Each pass, if `cur < a1`: take the pixel and key at
`P[cur]`; `j = cur-1`; while `j >= a0 && keys[P[j]] > key`: shift `P[j]` into `P[j+1]` (pixel and key); finally
write the held pixel and key at `P[j+1]`; `cur++`. The interval is done when `cur >= a1`. An interval of length
`n` needs `n-1` passes.

**Tests first.** Known case on `[3,1,2]` (three passes' states by hand); the equals-Sort and permutation
properties repeated with `Algo: insertion`; `TestInsertionPassesEqualLenMinusOne` for a single interval of 9.

**Verify.** `go test ./engine -run 'Stepper|Insertion' -race`.

**Commit.** `Add insertion stepper`

---

### P3-T03 · Bottom-up merge

**Goal.** Chunky blocks that merge: `ceil(log2 n)` passes.

**Files.** `engine/stepper_merge.go`, tests added.

**Spec.** Per interval keep a run width `w` starting at 1. Each pass, for `s = a0; s < a1; s += 2*w`: merge
`[s, min(s+w, a1))` with `[min(s+w, a1), min(s+2*w, a1))` using a scratch buffer (pixels and keys), **taking from
the left run on ties** (`keys[left] <= keys[right]`). Then `w *= 2`. Done when `w >= a1 - a0`. The scratch buffer
is allocated once per stepper, sized to the longest merge interval, never per pass.

**Tests first.** `[4,3,2,1]` passes by hand (`[3,4,1,2]` then `[1,2,3,4]`); stability test with
`UniqueIDImage` and `KeyRed` (equal keys keep original order); the equals-Sort and permutation properties with
`Algo: merge`; `TestMergePassCount`: a single interval of length 1000 finishes in exactly 10 passes.

**Verify.** `go test ./engine -run 'Stepper|Merge' -race`.

**Commit.** `Add merge stepper`

---

### P3-T04 · Reveal

**Goal.** Not an algorithm: finish whole intervals a chunk at a time, in scan order. The cheap "progressive" mode.

**Files.** `engine/stepper_reveal.go`, tests added.

**Spec.** The reveal family keeps a list of its interval indexes in order and a cursor. Each pass, sort the next
`max(6, ceil(len(list)/160))` intervals completely (stable counting sort, the same function as `Sort`). Done when
the cursor reaches the end.

**Tests first.** A plan with 50 intervals needs `ceil(50/6) = 9` passes (state it as a computed expectation in
the test: `max(6, ceil(50/160)) = 6`); equals-Sort and permutation properties with `Algo: reveal`.

**Verify.** `go test ./engine -run 'Stepper|Reveal' -race`.

**Commit.** `Add reveal stepper`

---

### P3-T05 · Mixed algorithms and progress

**Goal.** Different regions may use different algorithms in the same sort (the mockup does this).

**Files.** `engine/stepper.go` (finish), `engine/stepper_mixed_test.go`.

**Spec.**
- Each interval's algorithm is `Plan.Algos[i]`. `NewStepper` groups interval indexes by family
  (odd-even, insertion, merge, reveal) once. `Step()` advances every non-empty family once.
- `done` is true when every non-empty family is done (odd-even: two quiet passes; insertion: all cursors at the end;
  merge: every width covers its interval; reveal: cursor at the end).
- `Progress()`: for each non-empty family compute its fraction (odd-even: `min(0.99, pass / maxLenOfThatFamily)` until
  done, 1 after; insertion likewise with its own max length; merge: `passesDone / passesNeeded`; reveal:
  `cursor / count`), then average them weighted by the number of intervals in each family. Clamp to `[0, 0.99]`
  until `done`, then exactly `1`. It must be **non-decreasing**. Because odd-even's fraction is only an estimate,
  enforce monotonicity by keeping `max(previous, new)`.
- Remove any temporary `TODO(P3-T02)` from P3-T01.

**Tests first.**
- `TestProp_MixedAlgosEqualSort`: random regions where each class has its own `Algo`; stepping to done equals
  `Sort()` (this is `mockups/tests/region-algo.mjs`, widened).
- `TestProgressMonotone`: over a full run progress never decreases, stays below 1 before done, equals 1 at done.
- `TestAllFamiliesFinishTogether`: a plan using all four algorithms ends in a state where `Done()` is true only
  when every family is done (assert by stepping once more after done and seeing no change).
- `FuzzStepperEqualsInstant(data []byte)`: bytes choose size (<= 32x32), params, regions and an algo per class;
  stepping to done equals `Sort()`; never panics; `Pass()` stays under a generous bound (`maxLen*2+10`).

**Verify.** `go test ./engine -run 'Stepper|Mixed|Progress' -race -rapid.checks=500`; fuzz 30s.

**Commit.** `Mix algorithms per region and add progress`

---

### P3-T06 · Soft blend while stepping

**Goal.** `Image()` and `Result()` honour feather exactly like `Sort()`.

**Files.** `engine/stepper.go`, `engine/stepper_soft_test.go`.

**Spec.** As in the model section: when `soft != nil`, `Image()` writes `Lerp255(live, orig, soft[i])` per channel
into a scratch buffer the stepper owns and returns it. `Result()` returns a fresh copy of the same.

**Tests first.** With `Soft` all 255, `Image()` equals the original at every pass; all 0 equals `live`; at
completion `Result()` equals `Sort()` for random soft planes (property).

**Verify.** `go test ./engine -run 'Stepper|Soft' -race`.

**Commit.** `Blend feather while stepping`

---

### P3-T07 · Session API: step, progress, reset

**Goal.** The boundary gains animation (decision B1).

**Files.** `engine/api/session.go` (extend), `engine/api/session_step_test.go`, `cmd/wasm/main.go` (extend).

**Spec.** Add to `Session`:

```go
func (s *Session) Reset() error                    // after Prepare: a fresh Stepper from the plan; pixels return to the original
func (s *Session) Step(n int) (done bool, err error) // advance up to n passes (1..10000); stops early when done
func (s *Session) Progress() float64
func (s *Session) Pass() int
```

After `Reset`/`Step`, `Pixels()` returns the stepper's `Image()` buffer. `FinishInstant` still works from a
prepared plan and discards any stepper. `ErrState` rules as before (`Step` before `Reset`).

JS binding: `reset()`, `step(n)` returns `{ok, done, progress, pass}`; `pixelsPtr()` reflects the live buffer
(re-fetch every frame; the address can change if the soft scratch buffer is in use).

**Tests first.** Native tests: `Step` to done equals `FinishInstant` pixels; `Step(n)` with `n` larger than needed
stops at done and reports it; `Progress` reaches 1; `Reset` returns the original pixels; out-of-order calls give
`ErrState`. Extend `web/scripts/wasm-golden.mjs` to also run each golden recipe by stepping to completion in
batches of 50 and compare the hash again (stepper over WASM equals the goldens).

**Verify.** `go test ./engine/api -race`; `make wasm && node web/scripts/wasm-golden.mjs`.

**Commit.** `Add step and progress to the session API`

---

### P3-T08 · Animate in the worker and the lab

**Goal.** Watch it. The worker drives the stepping and streams frames; the page draws them.

**Files.** `web/src/lib/engine/protocol.ts`, `worker.ts`, `client.ts` (extend), `web/src/lib/engine/animator.ts`,
`animator.test.ts`, `web/src/routes/lab/+page.svelte` (extend), `web/e2e/animate.spec.ts`.

**Spec.**
- New requests: `animate { speed }`, `pause`, `resume`, `setSpeed { speed }`, `restart`. New response events (not tied
  to a request id): `frame { rgba, progress, pass, done }`.
- `animator.ts` is **pure**: given a time delta and `speed` (steps per second) it returns how many steps to run this
  frame, carrying fractional steps over, capped at 300 per frame (port `play()` in the mockup:
  `acc += min(0.1, dt) * speed`). It also implements **auto-fit**: if `speed` is `'auto'`, adapt the steps per frame
  so a frame takes about 16 ms (measure the last batch; clamp the change to x2 or /2 per frame).
- The worker loop: `requestAnimationFrame` is not available in workers in all browsers, so the loop uses
  `setTimeout(…, 0)` with `performance.now()` deltas, runs `step(n)`, takes the pixels (strategy from phase 2),
  and posts a `frame` with the buffer transferred. It stops posting after `done`. At most one frame is in flight:
  do not post the next until the page acknowledges (`ack`) the previous one, so a slow page cannot flood memory.
- The lab page: an Animate button, play/pause, a speed slider (steps/s, log scale 1 to 400) and an "auto" toggle,
  a progress bar and pass counter, a Restart button. While animating, changing a parameter pauses, re-runs
  `prepare` and restarts (latest wins).

**Tests first.**
- `animator.test.ts`: table of `(dt, speed, carry) -> steps, carry'`; the 100 ms cap; the 300 cap; auto-fit moves
  toward 16 ms and never changes by more than x2.
- `client.test.ts` additions: frames are delivered to a subscriber in order; the next frame is not requested before
  `ack`; `pause` stops frames; `restart` resets progress.
- `web/e2e/animate.spec.ts`: load an image, press Animate with a high speed, wait for `done`, then assert the final
  canvas equals the canvas produced by the instant button for the same recipe (compare pixel hashes).

**Verify.** `pnpm --dir web test`; `make e2e`; by eye in a real browser: animate a photo and watch it.

**Commit.** `Add animation to the worker and lab`

---

### P3-T09 · Measure the pass cost

**Goal.** The numbers PLAN.md section 3.7 asked for.

**Files.** `engine/stepper_bench_test.go`, `docs/perf.md` (extend).

**Spec.** `BenchmarkStepPass{OddEven,Insertion,Merge,Reveal}` at 1, 2, 8 and 24 MP on `Gradient` with mode
`random`, length 50 per mille (so intervals are long enough to matter), angle 30. Also a WASM run (a Node script
`web/scripts/bench-step.mjs` reusing the loader) for odd-even at 1 and 2 MP. Record medians in `perf.md` with the
machine, and state in one sentence whether 60 fps is plausible at 2 MP (a pass under about 12 ms in WASM).

**Verify.** `make bench`; `node web/scripts/bench-step.mjs`.

**Commit.** `Measure stepper pass cost`

---

### P3-T10 · Phase wrap-up

`make check`, `make test`, `go test ./engine -rapid.checks=2000`, `make fuzz FUZZTIME=30s`, `make wasm-test`,
`make e2e`. Tick `PROGRESS.md`. Record in `NOTES.md` the per-pass costs and any algorithm that is visibly
too slow to watch at working resolution (a plain statement is enough; the UI phase will decide what to expose).

**Commit.** `Finish phase 3`
