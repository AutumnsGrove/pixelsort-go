# Performance

Measured by `web/scripts/bench.mjs` (headless Chromium, engine on the main thread, 10 runs, medians in ms).

- Machine: Intel(R) Xeon(R) Processor @ 2.10GHz, 4 threads, linux 6.18.44-fc-v236
- Browser: Chromium 153.0.8010.12
- Date: 2026-11-04

| MP | prepare | sort | copy out + draw | view + draw | setImage in | worst sort |
|---|---|---|---|---|---|---|
| 1.0 | 38.2 | 16.7 | 3.5 | 3.1 | 7.6 | 32.4 |
| 2.0 | 68.9 | 31.7 | 6.0 | 5.2 | 10.1 | 40.6 |
| 8.0 | 286.0 | 157.5 | 123.7 | 139.2 | 36.3 | 197.1 |
| 24.0 | 822.9 | 535.5 | 397.7 | 340.8 | 106.6 | 1070.8 |

**Decision rule:** use the zero-copy view if it is at least 20% faster than copy at 8 MP and the view-length check never
failed; otherwise copy. At 8 MP copy is 123.7 ms and view is 139.2 ms, so the choice is
**copy**. Both give identical pixels (checked every run).
Both strategies stay in `worker.ts`; `/lab?transfer=copy|view` picks one so this can be re-measured. Phone numbers are
[HUMAN], optional: run `/lab/bench` on a phone and paste the table here.

## Stepper pass cost

One `Step()` on a mid-sort stepper (`go test ./engine -bench StepPass`, native amd64, same sandbox machine; Gradient
image, random mode, length 50 per mille, angle 30; medians of 20 passes, ms):

| MP | odd-even | insertion | merge | reveal |
|---|---|---|---|---|
| 1 | 3.0 | 1.6 | 9.1 | 0.08 |
| 2 | 7.9 | 2.0 | 21.1 | 0.10 |
| 8 | 59 | 6.9 | 124 | 0.69 |
| 24 | 238 | 15.3 | 354 | 2.3 |

No pass allocates. In WebAssembly (`node web/scripts/bench-step.mjs`), an odd-even pass is **4.2 ms at 1 MP and 8.7 ms
at 2 MP**, so 60 fps is plausible at 2 MP for odd-even (the target was under about 12 ms). Merge costs about 2.5x
odd-even per pass (it gathers and rewrites every span), so it is not watchable at 60 fps above about 1 MP in this
sandbox; the working copy is capped at 1920 px (about 2-3 MP), so the UI should lower the steps-per-frame or draw
fewer frames for merge at large sizes (the lab's auto speed already adapts the steps per frame, never the cost of one).

## Scrubbing (P9-T03)

`Session.Seek(pass)` jumps to the state after `pass` passes. Going forward it steps on; going back it restores the nearest
**checkpoint** (a clone of the stepper, about 5 bytes a pixel) and replays from there, so it never stores a frame per step.
Checkpoints are taken every pass at first, and the stride doubles (dropping the odd ones) whenever the cache is full; the cache is
limited to 96 MB (9 checkpoints at 2 MP, never more than 16). Without them a seek replays from pass 0.

Slowest single seek over 15 random jumps (forwards and back) after one run to the end, **2 MP of uniform noise** (the worst case
for the sorters), `go test ./engine/api -bench SeekMiddle2MP -benchtime=15x`, same sandbox machine, ms:

| | odd-even | insertion | merge | reveal |
|---|---|---|---|---|
| native amd64, slowest seek | 172 | 75 | 118 | 43 |
| WebAssembly (Node), slowest seek | 183 | 68 | 29 | 5 |
| WebAssembly, no checkpoints (stride 32, before this change) | 189 | 71 | **315** | 8 |

The target is a seek to any pass in under 300 ms at 2 MP: it holds for every algorithm. Merge has only about a dozen passes, so a
first stride of 32 never took a checkpoint for it; starting at every pass fixed that. The native column is noisier (the garbage
collector shows up in single seeks). Real photos are smoother than noise, so these are upper bounds.
