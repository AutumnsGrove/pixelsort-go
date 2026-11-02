# End of the mockup phase

**Date.** 2026-11-02.

**Status: design phase complete enough to start building.** There is no Go and no Svelte yet. What exists is a
full plan, a set of working mockups that settle the look and the interactions, and tests that pin down the
engine's behaviour. Autumn has not yet decided whether to finish the last few mockup flows first or to begin
Phase 0 of the plan; see "What I need".

## Where this is

- `PLAN.md` is the source of truth: goals, architecture, engine design, gallery, the Cloudflare Worker, homelab
  fit, testing strategy, phases, decisions and risks. Section 11 is the decisions log. Read it first.
- `mockups/` holds working HTML for four screens plus the shared code behind them. Open `mockups/index.html`
  from disk; there is no build step. Every page sorts for real, using a small JavaScript **stand-in** for the
  engine. The stand-in is throwaway; the real engine will be Go compiled to WebAssembly.
- `mockups/tests/` holds six browser suites, all green (`cd mockups/tests && pnpm install && pnpm test`). They test
  the stand-in, but the properties they check are the spec for the Go engine's tests.
- The repo is public at `github.com/AutumnsGrove/pixelsort-go` (MIT). The predecessor,
  `github.com/AutumnsGrove/Pixelsorting` (Python + Gradio), stays untouched as an archive of her early work.

## What exists

### The plan (`PLAN.md`)

Goals and non-goals; the architecture (browser does all the work in a Web Worker running `engine.wasm`; the
potato only serves files and stores results); the engine (scanline partition, intervals, regions, sort keys,
cellular automata, animated sorting, resolution rules); feature scope (what is ported, what is not); WASM
specifics; the gallery and server (schema, API, trash, 50 GB budget); share links and URL loading through one
Cloudflare Worker; homelab fit (Docker, port 8895); testing strategy; nine phases with exit criteria; the
frontend (screens, responsive rules, Lucide icons); decisions; risks; and an appendix auditing the Python.

### The screens (`mockups/`)

| File | What it is |
|---|---|
| `index.html` | Entry page: the screens, things worth trying, and the earlier directions. |
| `studio.html` | The main screen. Stage, dock of knobs (each opens one popover), live preview while dragging, filmstrip of past runs (`G`), first-run "Bring a picture" intake (drop, choose, paste a file or a link; `N`), and the **Pro panel** (`Tab`). |
| `phone.html` | The same instrument folded into a bottom sheet: Cut, Sort, Direction, Protect, Shapes, Runs. `studio.html` hands off to it below about 700 px wide. |
| `gallery.html` | **Archive**: usage numeral and 50 GB meter, All / Starred / Albums / Bin, "Free up space" smart-select, bulk dock, viewer with the recipe as a slate, share dialog, albums with revoke, bin with a 7-day clock. |
| `share.html` | What a friend sees (served by the Worker): image, strip, download, copy image link, recipe. `?gone` shows the revoked page. |
| `archive/` | The first-round directions (Grove-palette editor, riso phone, Grove gallery), kept for reference. |

### Shared code (`mockups/shared/`)

| File | What it does |
|---|---|
| `demo-engine.js` | The stand-in engine. Sorts along **any angle** by partitioning pixels into staircase lines (`k = y - round(x*tan(theta))`, no rotation), builds intervals (random, wave, threshold, edges, cellular, none), stable stepped sorts (odd-even, insertion, reveal), frozen pixels, **regions** (cells and classes with per-class angle, sort key and direction, and a full cutting recipe), feathered masks, loading your own picture. Never put the real engine's logic here. |
| `regions.js` | Tilings (square, hexagon, triangle, diamond, circle, octagon, Voronoi, custom), class patterns, outlines, and the **SVG pipeline**: parse as data, sample the longest outline into a polygon, normalise to the unit square. Eight starter shapes. |
| `mask-editor.js` | Masks as **objects**: ellipse, rectangle or polygon with centre and size as fractions of the picture, rotation, and `add` or `cut` mode. SVG handles to move, resize and turn; arrow-key nudge; rasterises into the engine's mask; `guessShape` turns a drawn loop into a shape. |
| `angle-dial.js` | The free-form direction dial (any angle 0 to 359; Shift snaps to 15). |
| `theater.css` | The shared design language: ink-black stage, warm paper text, one vermilion accent, a serif for voice and a mono for facts; grain, vignette, pill dock, glass panels, focus rings, reduced-motion. |

### Features the mockups demonstrate

Live preview while dragging any control, then replay as an animation; three live modes (live preview, animate,
reveal); a free-form direction dial; cutting the picture into shapes with per-kind overrides (frozen, direction,
sort key, ascending or descending, own cutting recipe); custom SVG shapes (drop or paste); masks as editable
objects with union, hole, invert, feather, snap-to-shape and "freeze the brightest spot"; your own photo by drop,
paste or link (direct fetch first, the Worker relay as fallback, simulated); the gallery, bin and share flows.
Not simulated for real: the server, the Worker, the relay, and export.

### Tests (`mockups/tests/`)

`engine-properties` (15 angles x 6 modes x 4 image shapes: partition is a bijection, sorting is a permutation,
intervals end sorted, stepper == instant), `region-properties` (56 configurations), `custom-shapes` (SVG parsing
plus 32 configurations with per-region cutting), `mask-editor` (18 real-pointer checks), `phone-mask`,
`layout-scan` (every screen at 840, 1024, 1920 and 390 px).

## What I did

Read the whole Python predecessor and the shapes-and-drawing plan; audited its quirks (Appendix A of the plan);
made the architecture decisions with Autumn (WASM in the browser, Go server, scanline sorting, regions as one idea,
Docker, a Cloudflare Worker for sharing and URL loading); wrote the plan; built and iterated the mockups to her
review; moved the verification scripts into the repo; and published it.

## What I need

1. **Which comes next?** (Recommendation: finish the three flows below that block real implementation, then
   start Phase 0. See "What happens next".)
2. **Cloudflare details,** needed by Phase 6b only: the Worker's name and account, whether the viewer lives on a
   custom domain or `*.workers.dev`, and the default share expiry (never or 30 days).
3. **Approval before touching the homelab.** Reserving port 8895, adding a row to the port map and a Meridian
   tile are not done and should wait until she approves the plan.

## What happens next

### A. Mockup flows not yet designed

In priority order, because the first three change real requirements:

1. **Presets.** Her Python app has eight built-ins (Main, File, Random, Kims, Gentle, Intense, Waves, Edges) plus
   saved ones. The plan says presets can hold ranges and re-roll when *applied*; Studio has no preset picker.
2. **Export.** Format, size, a device-memory warning (50 MP will not fit on a phone), banded progress, cancel.
3. **Threshold overlay** ("focus peaking"), kept from her Gradio app: show which pixels will be sorted.
4. Empty, full (80% and 100%) and offline states; a first-run tour; a keyboard-shortcut sheet; a Settings page
   with credits; own-cutting controls on the phone (it has frozen and direction only); holes and compound paths
   in custom shapes; a per-region animation algorithm.

### B. Phase 0 (plan section 9)

Scaffold the Go module (`github.com/AutumnsGrove/pixelsort-go`), a Makefile, and a hello-world WASM in a
worker. Verify that COOP and COEP headers survive `tailscale serve`, because `SharedArrayBuffer` needs them and
a secure context. Read her `ElementaryCAVisualizer` project before writing the cellular-automaton code. Exit
criterion: a page on the tailnet loads the WASM and gets an answer from Go. Add a `CLAUDE.md` at this point.

### C. Phase 1

The Go engine core with property tests. **Port `mockups/tests/` as the spec** (bijection, permutation, sorted,
stepper == instant, frozen never move, no cell crossed). Put the region map in the engine API from day one, even
if it is always "one region"; retrofitting it later is the expensive path.

## Risks

- **Nothing about speed is measured.** The stand-in is JavaScript. The plan's estimate (a few milliseconds per
  pass over a ~1080p working copy in WASM) is unverified; Phase 2 exists to measure it before promising 60 fps.
- **The stand-in differs from the real design in known ways:** SVG holes and element transforms are ignored;
  freehand strokes are raster, not vector; the share, relay and export flows are simulated; thumbnails come from a
  synthetic image; shapes persist in `localStorage` instead of the gallery database.
- **Fonts load from Google Fonts** in the mockups. The real app should self-host them.
- **Memory on phones.** A 50 MP image will not fit; the plan caps the working copy and bands the export, but this
  is untested.
- **The tests check the stand-in, not Go.** They only help if they are ported.

## Gotchas

- **Test at about 840 px wide.** A browser window with a sidebar open is roughly that, and it exposed three real
  bugs that 1440 px hid. `layout-scan` now covers it.
- **Never give a panel the same class as a state class on `<body>`.** The Pro panel was `.pro` and the body got
  `.pro` too, so opening it translated the whole page off-screen. It is `.propanel` and `body.pro-open` now.
- **Class collisions bite.** The dock's round `.sm` buttons collided with `.btn.sm` and squashed every small
  button into an oval. Namespaced to `.dsm`.
- **Do not paint region ids with Canvas 2D.** Canvas fills are anti-aliased and edge pixels blend two ids into a
  third. Fill polygons in the engine; use a canvas only for soft, alpha-style masks.
- **Never rebuild the DOM of a focused input.** Re-rendering the selected-shape card while a number field had focus
  threw on blur. Update values in place unless the selection or structure changed.
- **An uploaded SVG is data, never markup.** Parse it, sample it, throw it away. Do not inject it into the page.
- **Go's WASM is single-threaded.** Parallelism needs a pool of Web Workers and `SharedArrayBuffer`, which needs
  COOP/COEP and HTTPS. Plain `http://100.x.x.x` is not a secure context (no `SharedArrayBuffer`, no
  `crypto.subtle`), so serve through `tailscale serve`.
- **zsh does not word-split unquoted variables,** so `set -- $vp` gives one argument. Use arrays or `${=vp}`.
- **Do not signal-reload a container with `docker kill`.** Docker records it as a manual stop (the Meridian
  incident of 2026-11-01); use `restart: always` and `--watch`.

## Working with Autumn

She uses she/her. She wants to see a design before it is built, answers best to concrete options, and likes the
homelab kept consistent (Docker, the port map, a Meridian tile). She loved the Theater direction and asked for
anything outside the main screen to share it. Commit messages are present tense with a first line under 50
characters. Use `uv` for Python and `pnpm` for web projects.
