# Animation export (GIF, MP4/WebM, APNG)

Status: **built and tested** (A1–A7, branch `build/animation-export`). Supersedes the real-time `MediaRecorder` approach
sketched in `phase-9.md` P9-T02. The plan below is kept as history; "What was built" records where the implementation
differed.

## Goal

Save the sorting process as an animation (GIF, video, or APNG), in the web studio and from the CLI. Exports land in the
Archive and can be shared the same way images are.

## What was built

| Piece | Where |
|---|---|
| Pass bound and sampler (Go + TS, identical integer arithmetic) | `engine/stepper.go` `Plan.MaxPasses`, `internal/anim/sampler.go`, `web/src/lib/anim-sampler.ts` |
| CLI GIF/APNG/PNG sequence | `cmd/pixelsort-go/render.go`, `internal/anim/{gif,apng,quantize}.go` |
| Streaming encoders and export loop | `web/src/lib/anim-{gif,apng,video}.ts`, `export-anim.ts` |
| Animation panel and preview | `web/src/lib/components/AnimationPanel.svelte`, `anim-panel.ts` |
| Archive storage and viewer | `server/runs`, `server/blob`, `RunViewer.svelte`, `archive/+page.svelte` |
| Sharing | `server/share`, `worker/src/{validate,viewer}.ts` |

Infinity mode (sort, then unsort back to the original, looping with no seam) is in `infinity-mode.md`. It reuses this
pipeline unchanged: it only hands the export loop a longer `Sequence`.

### Where the implementation differs from the plan

- **The pass total is a bound, not exact.** Odd-even only ends after two quiet passes, so `Plan.MaxPasses` computes an
  upper bound from the interval/algorithm mix. Stepping that many passes always reaches `Plan.Sort`, which the sampler
  and its property tests rely on.
- **Frames repeat when there are more frames than passes.** The plan's "strictly increasing" rule cannot hold for a
  5-second export of a 10-pass merge sort. `Sample` is non-decreasing; it is strictly increasing whenever
  `frames <= passes + 1`, and falls back to linear so repeats spread evenly otherwise.
- **Mediabunny replaced `mp4-muxer`/`webm-muxer`.** Both plan suggestions are deprecated upstream. Mediabunny (MPL-2.0)
  is lazy-loaded as its own 224 KB chunk; feature detection uses raw WebCodecs so the main bundle stays small.
- **Web GIF dithering is ordered (Bayer 8x8).** gifenc maps colours to the palette itself; the CLI still uses
  Floyd-Steinberg. The palette is still one global median-cut/GIF palette per export.
- **Video sizes round down to even dimensions.** H.264 rejects odd sizes; APNG/GIF keep the requested size.
- **APNG is stored as `image/png`.** It shares the PNG signature and browsers animate it under that MIME; the run still
  carries a `video_id`, so the viewer and share path know it is the animation.
- **The browser encoders keep the finished file in memory.** The panel warns at half the device's budget and refuses
  (disables Export) over the whole budget with a sentence naming the size. Streaming was not worth a new container writer
  for GIF/APNG; the CLI does stream.
- **The end hold is part of the last frame's delay**, for every format, so it is included in the video timestamp as well.

### Acceptance, and where it is proved

- Final frame equals the instant result: `cmd/pixelsort-go/render_anim_test.go` (APNG last frame vs `render --out`), plus
  the CLI GIF final-sort test.
- Same recipe, same frames: sampler vectors shared by Go/TS; deterministic engine (`plan_prop_test.go`).
- Preview and export use the same `Sequence`: `export-anim.test.ts` and the panel walk `sequenceFor`.
- Cancel, progress, and oversized refusal: `export-anim.test.ts`, `anim-panel.test.ts`, panel e2e.
- Archive playback and GC: `runs_test.go` (`TestDeleteTrashedFreesTheAnimation`), archive e2e.
- Share opt-in/cap and public playback: `server/share_test.go`, Worker `albums`/`public` tests.
- No WebCodecs disables video: `anim-video.test.ts` and the panel's disabled formats.
- The 25 MB cap fits the Worker: `MAX_OBJECT_BYTES` is 30 MB, so the server's cap is the tighter one.

## Decisions

- **Clean offline render, not screen capture.** An export loop steps the engine and encodes frames itself. Output does not depend
  on machine speed or on the live animation's adaptive pacing (`animator.ts`). The engine is deterministic and
  `Session.Seek(pass)` gives exact random access, so no frames are stored while sorting.
- **Three formats:** GIF (most shareable, 256 colours), MP4/WebM (best quality and size), APNG (lossless, large).
- **Browser encodes, engine only handles pixels** (decision B2). The web side adds no Go-WASM encoder.
- **Settings stay in the studio.** The animation panel only holds export-specific controls. It renders from the studio's current
  recipe and image, and never edits them.
- **CLI too:** `render --anim` for scripting and batch, using stdlib `image/gif` and a small Go APNG writer.

## Pieces

### 1. Frame sampler (shared concept, two implementations)

Given total passes `P` (known after `Prepare`) and the chosen frame count `N`, pick the pass for each output frame.

- `linear`: even spacing.
- `ease-out` (default): front-loaded, because most visible change happens early.
- Always include pass 0 (the original) and the final pass; add an optional end-hold of `H` ms on the last frame.
- Frame count comes from `duration x fps`, capped by a memory/size guard.

### 2. Web export loop

- New `web/src/lib/export-anim.ts`: runs the sampler, calls `step`/`seek`, reads pixels, scales, and passes each frame to an
  encoder. Reports progress and supports cancel.
- Runs against its own engine session or worker so the live studio animation is untouched.
- Reuse the memory `plan()` in `export-model.ts`; extend it with `frames x w x h x 4` and refuse or downscale with a clear message.
- Encoders (new, lazy-loaded so they cost nothing until used):
  - **MP4/WebM:** WebCodecs `VideoEncoder` plus a small muxer library (mp4-muxer / webm-muxer). Feature-detect WebCodecs and
    codec support; hide or disable the format with a reason when unavailable.
  - **GIF:** a quantizer/encoder library (e.g. gifenc) with a global palette from the first and last frames, optional dithering.
  - **APNG:** a small in-repo writer (PNG chunks acTL/fcTL/fdAT) on top of the existing PNG encode path.
- Dependency choices need a licence and bundle-size check before adoption (see Resolved decisions).

### 3. Animation panel (new, separate from the studio controls)

Controls only for export:

- Format (GIF / MP4 / WebM / APNG), scale (reuse `SCALES`), fps, duration, easing (linear / ease-out), end-hold, loop (GIF/APNG).
- **Preview:** plays the exact frame sequence the export will produce, in a canvas, on the same sampler. Speed multiplier
  (0.25x to 4x), play/pause, and a scrubber. Changing duration/fps/easing updates the preview immediately.
- Estimated size and frame count, with warnings from the memory guard.
- Export button, progress bar, cancel.

### 4. Archive and sharing

- Server: store the result as `images.kind = 'video'` (schema and `runs.video_id` already exist) for all animated formats; GIF/APNG
  are stored with their real MIME. Extend the blob allowlists (`server/blob/blob.go` already allows GIF; add `video/mp4`,
  `video/webm`, `image/apng`) and the API error text (`server/api/api.go`).
- Blob GC: confirm the existing handling in `server/runs/trash.go` deletes the animation blob when the run is permanently deleted.
- Archive page: show a badge on runs that have an animation; play it in the viewer (`<video>` or `<img>`).
- Share: `server/share/service.go` `allowedMime` currently allows only PNG/JPEG/WebP. Allow the animated types, and make the
  worker (`worker/src/albums.ts`, `public.ts`, `viewer.ts`, `fetch.ts` sniffer) store, sniff and serve them. Size cap on shared
  animations; opt-in per run in the album, like the earlier P9-T02 spec. Public pages render GIF/APNG as `<img>` and video with
  `<video controls loop muted playsinline>`.
- Thumbnail: the existing WebP thumbnail (final frame, or a mid frame) stays the run's thumb.

### 5. CLI

- `pixelsort-go render --anim out.gif|out.apng` with `--fps`, `--duration`, `--ease`, `--hold`, `--scale`, `--loop`.
- Loops `plan.NewStepper()` and `Step()`, using the same sampler logic (port with golden tests so web and CLI pick the same passes).
- GIF via stdlib `image/gif` with a palette (e.g. `palette.Plan9` or a median-cut quantizer written in `internal/`); APNG via a small
  writer. MP4/WebM are **not** done natively (would require ffmpeg or a cgo-free encoder); the CLI can emit a PNG sequence
  (`--frames dir/`) so users can pipe into ffmpeg themselves.

## Phases

1. Sampler (Go + TS), with property tests: includes first and last pass, strictly increasing passes, count is exact.
2. CLI GIF/APNG/frames output (self-contained, no web work).
3. Web export loop with GIF + APNG (no new browser APIs).
4. MP4/WebM via WebCodecs with feature detection.
5. Animation panel with preview.
6. Archive storage, viewer, delete/GC.
7. Sharing (server + worker + public pages).

Each phase is independently shippable; 1 to 3 give a usable feature.

## Acceptance

- The final frame of every format equals the instant result (`Plan.Sort`) for golden recipes.
- Exporting the same recipe twice yields identical frame sequences (same passes, same pixels), regardless of machine speed.
- Preview and export use the same sampler (same frame list).
- Cancel works and frees memory; oversized requests are refused or downscaled with a clear message.
- A saved animation plays in the Archive, shares like an image (opt-in, size-capped), and is removed by blob GC on permanent delete.
- Unsupported formats (no WebCodecs) are disabled with an explanation, not a crash.

## Resolved decisions

- **GIF palette:** one global palette built from sampled frames (first, last, a few in between), with dithering. Avoids palette
  flicker between frames and keeps files smaller. Not user-selectable for now.
- **Encoder dependencies:** small third-party libraries, lazy-loaded when the animation panel opens (gifenc for GIF;
  mp4-muxer / webm-muxer with WebCodecs for video). APNG stays in-repo. Licence and bundle-size check still required before adding.
- **Share size cap:** a single fixed cap of 25 MB for shared animations. The export panel warns when the estimate exceeds it, and
  sharing refuses larger files with a clear message. Revisit per-format caps if GIF proves too heavy in practice.

## Risks and open questions

- GIF quality on photos (banding) with a global palette; dithering mitigates it.
- Memory: frame count x resolution. Prefer streaming each frame into the encoder rather than buffering all frames.
- `Seek` cost at high resolution (P9-T03 target is 300 ms at 2 MP); sequential `Step` is cheaper for in-order sampling, so use
  `Step` and reserve `Seek` for preview scrubbing.
- Safari/Firefox WebCodecs support varies; MP4 (H.264) vs WebM (VP9/AV1) availability needs detection.
- ~~Confirm the Cloudflare Worker can store and serve blobs up to the 25 MB cap.~~ Resolved: the Worker's object cap is
  30 MB, so the server's 25 MB animation cap is the binding limit.
- ~~Whether the phase-9 P9-T02 entry should be replaced by this plan~~ Resolved: P9-T02 is marked superseded.
