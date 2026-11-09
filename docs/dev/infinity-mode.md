# Infinity mode (sort → unsort → loop)

Status: **built and tested**, phases 1 and 2 (issue [#23](https://github.com/AutumnsGrove/pixelsort-go/issues/23), branch
`build/infinity-mode`). Phase 3 (the live canvas) is not built. Builds on `animation-export.md`, which is already shipped.

## The idea

Watch a sort start from the original picture, run to the finished one, then run **backwards** to the original, and
repeat forever. Exported, the loop has no seam: the last frame flows into the first through the same motion.

Two surfaces, one rule: the panel's preview and every export. A third (the live studio canvas) is a later phase.

## What was built

| Piece | Where |
|---|---|
| The round trip, both languages, identical arithmetic | `web/src/lib/anim-sampler.ts` (`roundTrip`, `newSequence`), `internal/anim/sampler.go` (`RoundTrip`, `NewSequence`) |
| Mode in the panel's settings and a Mode control | `web/src/lib/anim-panel.ts` (`ANIM_MODES`, `AnimSettings.mode`), `AnimationPanel.svelte` |
| `--mode once|infinity` on the CLI | `cmd/pixelsort-go/render.go` |
| A walker that can rewind, so a round trip is not one full sort per return frame | `internal/anim/walk.go` |

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
- **The dead tail is still there.** `Session.ExactPasses()` is not built: the CLI and the studio must pick the same
  passes (they are ports of each other), so it has to land in both at once, and that is its own commit. Meanwhile a
  long animation still freezes on the finished picture before the turnaround, at both ends of every loop.
- **The loop holds at both ends and can close itself.** Frame 0 (the original) gets the end-hold as well as the finished
  picture, and `loop=false` appends the original as a closing frame so a one-shot export ends where it began.
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
3. **Preview.** `nextFrame` becomes direction-aware (bounds tip at both ends: 0 → 1 forward, `2N-2` → `2N-3` back),
   which needs the return leg's pixels from the same `show(i)` the panel already calls. `once` keeps today's behaviour.
   The scrubber is already pass-indexed, so it just ranges over the loop.
4. **Export.** Nothing. GIF/APNG keep their `loop` flag; MP4/WebM loop in the Archive viewer and the shared page, which
   both already carry `<video loop>`.
5. **CLI.** `render --anim --mode infinity`, same sequence builder, so a scripted export matches the studio byte for byte.

## The wrinkle to measure: every return-leg frame is a backward seek

A backward `Seek` clones the nearest checkpoint and replays forward, so a rewind frame costs about *stride/2* passes, and
the checkpoint stride doubles as the cache fills (`ckptFirstStride`, `ckptBudget` = 96 MB). With ~16 checkpoints that is
`P/32` passes a frame: at 24 fps, roughly `0.75P` passes a second. Forward playback is adaptive — `animator.ts` targets
16 ms — but the rewind is a fixed rate, so a long odd-even sort on a big picture may stutter on the way back.

Plan: measure it on the largest picture we ship, then pick from

- raise `ckptBudget` for the animation session only (it already owns a second session, so the studio is unaffected);
- cache the *preview-scaled* frames the return leg needs (about 1 MB each at the panel's 520 px cap — affordable only if
  the frame count stays small, so this needs a limit rather than a guess);
- or, if neither is enough, drive the preview from the export loop instead of the worker, which walks forward once.

Do not pick one before measuring. Note the result at the top of `NOTES.md` with the number.

Export pays the same cost once, so a 4 s round trip should still finish in seconds; if it does not, the same fix applies.

## The other wrinkle: the dead tail becomes visible

`MaxPasses` is an *upper bound* — odd-even stops after two quiet passes — so the late frames of a long animation show the
finished picture already. Infinity mode makes that a freeze at both ends of every loop, which is the one thing the feature
is meant to make beautiful.

- **Recommended:** add `Session.ExactPasses()` (or `Plan.ExactPasses()`), which runs a throwaway stepper to completion and
  returns `stepper.Pass()`. One extra full sort per recipe change, on the panel's own session, which exists for this kind
  of work and is not the live one. Deterministic, no behaviour change, no goldens.
- Rejected: hashing frames during the export and trimming. It costs a whole export to learn the answer, and the preview
  would have played a sequence the file does not use.
- Doing nothing is also honest for phase 1; the freeze is bounded by the bound's looseness.

This also improves the existing `once` export, so it is a good separate commit either way.

## Tests (these are the specification)

- `web/src/lib/anim-sampler.test.ts` and `internal/anim/sampler_test.go`, same vectors in both:
  round trip is `2N-2` frames; first frame is pass 0 and last is pass 1; no two adjacent frames share a pass when
  `N <= P+1`; delays are the forward delays mirrored; the hold lands on both turnarounds; `P == 0` falls back to `once`;
  a leg is never shorter than `MinFrames`.
- Property: for any `P` and `N`, the loop reversed is itself mirrored — `passes[k] == passes[2N-3-k]` for the middle,
  and the two legs are the same list seen from opposite ends. (No `rapid` needed on the web side; `rapid` on the Go side.)
- `web/src/lib/anim-panel.test.ts`: the mode is part of `AnimSettings`, has a default, and survives a settings round trip;
  `nextFrame` turns at both ends and only stops when not looping.
- `web/src/lib/export-anim.test.ts`: the source is called in sequence order, so the return leg asks for descending passes,
  and frames reach the encoder in time order.
- `cmd/pixelsort-go/render_anim_test.go`: the last frame of a `--mode infinity` export is pass 0's picture, and the frame
  before the first sorted one is pass 1 — i.e. the loop closes.
- Panel e2e: choose Infinity, preview it, export it, and assert the first two frames are not identical (a doubled
  turnaround frame is the bug this feature is most likely to ship with).
- Determinism: same recipe and settings give the same bytes, twice.

## Phases

1. **Sequence and export** — done: the sampler in both languages, the mode in `AnimSettings`, the panel control, the
   export. The preview needed no change beyond drawing whatever frame the sequence asks for.
2. **CLI** — done: `--mode infinity`, same builder.
3. **Live canvas** — not built. The studio's own sort still stops at `done`; looping it needs the rewind measurement
   below, and may want its own issue.

## Out of scope

- A true inverse sort, undo logs, or a per-pixel rewind.
- Different easing or a different speed on the return leg (the return mirrors the outbound trip).
- Audio, speed ramps, or a "boomerang with pauses" variant.
- Rewriting already-exported animations into infinity mode on the server. It is an export setting, not a post-process.
