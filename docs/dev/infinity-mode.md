# Infinity mode (sort → unsort → loop)

Status: **built and tested**, all three phases: the panel and every export (issue
[#23](https://github.com/AutumnsGrove/pixelsort-go/issues/23), PRs #25 and #26), and the live studio canvas. Builds on
`animation-export.md`, which is already shipped.

## The idea

Watch a sort start from the original picture, run to the finished one, then run **backwards** to the original, and
repeat forever. Exported, the loop has no seam: the last frame flows into the first through the same motion.

Three surfaces, one rule: the panel's preview, every export, and the live studio canvas.

## What was built

| Piece | Where |
|---|---|
| The round trip, both languages, identical arithmetic | `web/src/lib/anim-sampler.ts` (`roundTrip`, `newSequence`), `internal/anim/sampler.go` (`RoundTrip`, `NewSequence`) |
| Mode in the panel's settings and a Mode control | `web/src/lib/anim-panel.ts` (`ANIM_MODES`, `AnimSettings.mode`), `AnimationPanel.svelte` |
| `--mode once|infinity` on the CLI | `cmd/pixelsort-go/render.go` |
| A walker that can rewind, so a round trip is not one full sort per return frame | `internal/anim/walk.go` |
| The live loop: the worker turns round at the end and seeks back down | `web/src/lib/engine/{worker,animator,protocol,client}.ts`, `studio.svelte.ts`, `routes/studio/+page.svelte` |

### Where the implementation differs from the plan

- **`nextFrame` did not need to change.** The plan expected the preview's stepping to become direction-aware. It does
  not: the sequence already *is* the direction, so playback is still a plain 0, 1, 2 … wrap. Less code, and the preview
  cannot disagree with the file.
- **The mode is not remembered per device.** The panel remembers none of its animation settings today, so persisting
  only the mode would be odd. It starts at `Once` every time; make all of the panel's settings sticky together, later.
- **`Walk` grew a small checkpoint cache.** The CLI's walker only stepped forward, and showing an earlier pass would have
  meant replaying from the original for every return-leg frame — one full sort per frame. It now keeps up to sixteen
  clones (a 96 MB budget, the same estimate as the engine session's scrub cache) so a rewind replays from the nearest.
  `anim.NewSequence(..., Infinity, ...)` and a file therefore cost about one sort forward plus one stride per frame back.
- **The dead tail is measured and left alone.** `Session.ExactPasses()` is not built: the bound turned out to be 0–3%
  loose on photographs, so the payoff is a few frames against a whole extra sort at panel open. See the section below.
- **The loop holds at both ends and can close itself.** Frame 0 (the original) gets the end-hold as well as the finished
  picture, and `loop=false` appends the original as a closing frame so a one-shot export ends where it began.
- **"Does it loop" is now a property of the format, not just of the checkbox.** The sequence has to know, because a closed
  loop has an extra frame. Our viewers always loop a video, so MP4/WebM count as looping whether or not the GIF setting
  was left off (`loopsByItself`), which also stops the preview from halting where the video would keep going. Found in
  review.
- **The loop has about as many frames as a `once` export of the same duration.** Splitting the duration between the two
  legs means 4 s at 24 fps is 96 frames once and 94 frames as a loop, so the size estimate, the memory refusal and the
  user's expectation of "4 seconds" all still hold.

## The one thing that makes it cheap: an unsort is a replay, not an inverse

There is no "unsorting algorithm" to write. Reversing a stepped sort means showing the **passes in reverse order**.

- The stepper only moves a pixel when its key is strictly greater than a neighbour's (`engine/stepper.go`), so the
  state after pass *p* is unique for a given recipe. Pass *p* of the return leg is literally pass *p* of the forward leg.
- `Session.Seek` already walks backwards: it clones the nearest checkpoint and replays (`engine/api/session.go`). No new
  engine entry point is needed.
- A genuine inverse (undo a swap) has nothing to undo *with*: the swap decision is gone once the pass ends. The only
  faithful reconstruction is the state that produced it.
- Rejected: **recording the swap log** and undoing it. A sort's total swaps are on the order of its inversions, so the
  log is unbounded on a noisy picture. Rejected: **animating the inverse permutation** of the finished sort. It reaches
  the original, but the intermediate frames are a different (and less interesting) trajectory, and it is more code for
  the same answer.

Consequence: **no engine change, no golden changes, no `EngineVersion` bump.** If that stops being true, the design went
wrong somewhere.

## The second thing that makes it cheap: it is a longer sequence

The export loop (`web/src/lib/export-anim.ts`) plays `Sequence.passes` in order and gives each frame `delaysMs[i]`.
The frame count is `seq.passes.length`, and that one number already feeds the encoder header, the size estimate and the
memory refusal (`AnimationPanel.svelte`). So a round trip is **a longer sequence**, and the export loop, encoders,
memory guard and save path need no changes at all.

The rule for building it, with a forward leg of `N` frames over `P` passes (the existing sampler):

| | Frames | Passes |
|---|---|---|
| Forward leg | `N` | `passes[0..N-1]`, i.e. pass 0 to pass `P` |
| Return leg | `N-2` | `passes[N-2..1]` reversed — both endpoints dropped |
| Loop | `2N-2` | starts at pass 0, ends at pass 1, so frame `2N-2` wraps to frame 0 with no repeated frame |

- Dropping both endpoints from the return leg is what removes the doubled frame at each turnaround. A naive
  `passes + reverse(passes)` holds the finished picture for two frames and the original for two frames, which reads as a
  stutter exactly where the loop should breathe.
- **Delays mirror the forward leg**, so the return has the same velocity as the outbound trip and the turnaround
  decelerates naturally. Rejected: easing the return leg too (ease-out again), which looks like the sort changing speed
  at the seam.
- **The hold goes on both turnarounds** — the finished picture at frame `N-1` and the original at frame 0 — not on pass
  1 at the end of the return leg, where it would stall the motion mid-flight.
- **`durationSec` is the whole round trip.** Each leg gets half, with a floor of `MinFrames`. Rejected: duration per leg,
  where the default 4 s would quietly write an 8 s file.

Edge cases: `P == 0` (nothing sortable) falls back to `once` rather than flickering between two identical frames; a leg
that rounds below `MinFrames` is raised to it; `MAX_FRAMES` applies to the whole loop, so the round trip doubles the
estimate before the cap bites.

## Where it shows up

1. **Sampler, both languages.** `newSequence` gains a mode (`once` | `infinity`) in `web/src/lib/anim-sampler.ts` and
   `internal/anim/sampler.go`, which stay ports of each other (integer arithmetic, same vectors in both tests, as today).
   One shared helper builds the round trip so the panel preview, the export and the CLI cannot disagree.
2. **Panel.** One control: Mode `Once` / `Infinity`, default `Once` for the first release and remembered per device in
   `settings.svelte.ts`. Default `Infinity` is the nicer demo and the obvious follow-up once the rewind is smooth.
3. **Preview.** Nothing: `nextFrame` stays a plain wrap, because the sequence already carries the direction (0 → 1 →
   `2N-2` → 0). The plan expected direction-aware stepping here; see "Where the implementation differs" above.
4. **Export.** Nothing. GIF/APNG keep their `loop` flag; MP4/WebM loop in the Archive viewer and the shared page, which
   both already carry `<video loop>`.
5. **CLI.** `render --anim --mode infinity`, same sequence builder, so a scripted export matches the studio byte for byte.

## The wrinkle that was measured: every return-leg frame is a backward seek

A backward `Seek` clones the nearest checkpoint and replays forward, so a rewind frame costs about *stride/2* passes, and
the checkpoint stride doubles as the cache fills (`ckptFirstStride`, `ckptBudget` = 96 MB). With ~16 checkpoints that is
`P/32` passes a frame: at 24 fps, roughly `0.75P` passes a second. Forward playback adapts — `animator.ts` targets 16 ms
— but the rewind is at a fixed rate.

Measured on the largest picture we ship (`web/static/samples/forest.jpg`, 1600×900 at 50%, odd-even at 30°, 4 s at
24 fps, GIF, arm64):

| | Wall time | File |
|---|---|---|
| `--mode once` (96 frames) | 5.5 s | 23.0 MB |
| `--mode infinity` (94 frames) | 7.4 s | 22.3 MB |

The return leg costs about a third extra, and the file is the same size because the loop has the same number of frames.
The existing checkpoint cache is enough, so none of the three fixes below were needed: no bigger budget, no cached
preview frames, no driving the preview from the export loop. The preview does not stutter on this picture either.

If a much larger picture does stutter while rewinding, the options are, in order: raise `ckptBudget` for the animation
session only (it already owns a second session, so the studio is unaffected); cache the *preview-scaled* frames the
return leg needs (about 1 MB each at the panel's 520 px cap, so this needs a frame limit rather than a guess); or drive
the preview from the export loop, which walks forward once.

## The other wrinkle: the dead tail, measured and left alone

`MaxPasses` is an *upper bound* — odd-even stops after two quiet passes — so the late frames of a long animation show the
finished picture already, and a loop freezes at both ends for that stretch.

The plan was to add `Session.ExactPasses()`: run a throwaway stepper to completion and use `stepper.Pass()`. Measured
instead (`docs/dev/NOTES.md`, 2026-11-09), the bound is **0–3% loose on photographs** — 2% at 1600×900, 3% at 800×600,
9% at 1600×900 with `length` 100 — with one outlier at 16% for a 320×240 thumbnail, where the bound's fixed `+2` matters.
Insertion, merge and reveal are exact to the pass.

So it is **not built**: a few percent of frames at each turnaround is smaller than the default 500 ms hold, and the price
is a whole extra sort at panel open — exactly when the preview should appear. If the tail ever does matter, that is the
number to beat: under 3% on the pictures people export.

Rejected for the same reason as before: hashing frames during the export and trimming after the fact, which costs an
entire export to learn the answer and makes the file disagree with the preview that has already played.

## The live canvas (phase 3): the same loop in the studio

The studio's own animation loops now, driven by the worker: when the sort finishes it turns round and **seeks** back
through the passes, one frame at a time, using the session's checkpoint cache. The page never sees a difference — it gets
frames — and the loop is a superset of the old behaviour (with Loop off the animation stops on the finished picture
exactly as it did before).

Design decisions worth knowing:

- **The rewind keeps the forward pass rate**; the frame rate does what the machine allows. A rewind frame is a seek, which
  replays from the nearest checkpoint, so the way back costs more than the way in. Measured (`api.Session.Seek`,
  native, 16 checkpoints): **29 ms** a frame at 1600×900, 5 ms at 900×600, 6 ms at 1280×720. So a small or medium picture
  rewinds smoothly and a large one rewinds at 10–15 fps — choppy, but the motion is the same speed, which is what makes it
  read as the sort running backwards rather than as a stutter.
- **The choice is in the Watch popover** (algorithm, speed, loop), not a new dock button: it is a way of watching the sort.
- **Turning Loop off mid-rewind finishes the trip home and stops on the original**, rather than snapping to the end.
- **Scrubbing means the way forward**: a seek resets the direction, so Resume after a drag sorts on from there.
- **The setting is not remembered** between visits, for the same reason the panel's is not — the studio's own animation
  settings (`speed` included) are not sticky, and one sticky knob out of nine would be odd.

## Tests (the specification, and where it is proved)

- `web/src/lib/anim-sampler.test.ts` and `internal/anim/sampler_test.go`, the same cases in both: the round trip is
  `2N-2` frames; it starts at pass 0 and ends at pass 1; no two adjacent frames share a pass; a repeated endpoint is not
  repeated at the seam; the hold lands on both ends; `loop=false` adds the closing frame; an unsortable picture stays a
  still; Infinity splits the duration between the legs (94 frames against 96 at 4 s and 24 fps).
- Property, both languages: with one frame per pass, the two legs mirror each other (`loop[len-k] == fwd[k]`), the highest
  pass is the finished sort, and it appears once.
- `web/src/lib/anim-panel.test.ts`: the mode is part of `AnimSettings` and defaults to `once`; `sequenceFor` walks back
  down in Infinity mode; `nextFrame` still loops or stops at the end (it did not need to learn about direction).
- `web/src/lib/export-anim.test.ts`: the source is called in sequence order, so the return leg asks for descending passes,
  and the frames reach the encoder in time order.
- `internal/anim/walk_test.go`: every rewound frame matches the forward walk's pixels, and pass 0 gives the original back;
  `walk_internal_test.go`: a forward-only walk takes no checkpoints (they cost 5 bytes a pixel) and a rewinding one does.
- `cmd/pixelsort-go/render_anim_test.go`: a `--mode infinity` frame sequence starts at the original, reaches the finished
  sort once on the way in, and is still coming back down at the end; with `--loop=false` the last frame is the original.
- Panel e2e: choose Infinity, scrub to the end of the loop and assert the canvas is nearer the original than the middle
  of the loop is, scrub back down to prove a backward seek lands on the right frame, then export and check the GIF.
- `web/src/lib/engine/animator.test.ts`: the loop helpers — where a finished sort goes, the pass a rewind frame lands on
  (never past the original, always moving), and the turn at home.
- `web/e2e/infinity.spec.ts`: with Loop on the state reads "rewinding" and the pass comes back down, then forward again;
  pausing a rewind holds the picture; turning Loop off mid-rewind finishes the trip home and stops on the original.
- Determinism: same recipe and settings give the same bytes, twice.

## Phases

1. **Sequence and export** — done: the sampler in both languages, the mode in `AnimSettings`, the panel control, the
   export. The preview needed no change beyond drawing whatever frame the sequence asks for.
2. **CLI** — done: `--mode infinity`, same builder.
3. **Live canvas** — done: the worker drives the direction, the Watch popover has the toggle, and a rewind frame is a
   seek through the session's own checkpoint cache. The measurements that shaped it are below.

## Out of scope

- A true inverse sort, undo logs, or a per-pixel rewind.
- Different easing or a different speed on the return leg (the return mirrors the outbound trip).
- Audio, speed ramps, or a "boomerang with pauses" variant.
- Rewriting already-exported animations into infinity mode on the server. It is an export setting, not a post-process.
