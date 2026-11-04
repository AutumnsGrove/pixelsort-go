# pixelsort-go

A pixel sorter where you can **watch the sort happen** — live, in the browser, at any angle.

The engine is written in Go and compiled to WebAssembly, so it runs on whatever device loads the page. A
SvelteKit front end drives it, and a small Go server keeps a gallery of every run. It is a ground-up rewrite of
an earlier Python/Gradio project, [Pixelsorting](https://github.com/AutumnsGrove/Pixelsorting), which stays as an
archive of the original.

> **Status: early build.** Phase 0 is in: the repo builds, lints and tests itself with `make check`, and the
> engine's WebAssembly runs inside a web worker. The engine itself lands in phase 1. The plan and the throwaway
> mockups are still the reference for what it will look like.

## Develop

Requires Go 1.27, Node, `pnpm` and `golangci-lint` v2. The commands live in the `Makefile`:

| Command | What it does |
|---|---|
| `make check` | format check, vet, lint and the fast tests — run before every commit |
| `make test` | every Go test, with the race detector |
| `make fuzz` | a short run of every fuzz target (`FUZZTIME=2s` to shorten) |
| `make wasm` | build the engine to WebAssembly in `build/` |
| `make wasm-test` | run the engine's tests inside WebAssembly under Node |
| `make hello` | load the built WASM in Node and call it |
| `make spike` | serve the phase 0 spike page on `127.0.0.1:8895` |
| `make bench` | benchmarks |
| `make web` `make web-test` `make e2e` | the SvelteKit app (phases 5+) |

How the project is built — conventions, the test-first loop, one commit per task — is in
[`docs/dev/README.md`](docs/dev/README.md). Start there.

## What is here

| | |
|---|---|
| [`PLAN.md`](PLAN.md) | The whole plan: goals, architecture, the engine design, gallery and share links, deployment, tests, phases, decisions. **Start here.** |
| [`docs/dev/`](docs/dev/README.md) | **How it gets built**: test-first development plans, one file per phase, written to be handed to a coding agent, plus the protocol, conventions and testing guide. |
| [`docs/update.md`](docs/update.md) | The in-app update design (Settings, the host-side watcher, rollback). |
| [`docs/handoffs/`](docs/handoffs/) | Handoff notes — where things stand and what happens next. The latest one is the best way back in. |
| [`mockups/`](mockups/) | Working HTML mockups of every screen. Open [`mockups/index.html`](mockups/index.html) in a browser — no build step. |
| [`mockups/tests/`](mockups/tests/) | Browser tests that check the mockups' engine properties, mask editor and layouts. |

## Try the mockups

```bash
open mockups/index.html          # or just double-click it
```

Every page runs a small JavaScript **stand-in** for the real engine, so you can watch a sort animate, spin the
direction dial to any angle, tile the picture into shapes (including your own SVG), protect areas with shapes you
can move and resize, and drop in your own photo. The stand-in is throwaway; the real engine will be Go.

```bash
cd mockups/tests && pnpm install && pnpm exec playwright install chromium
pnpm test                         # all 19 suites: engine, regions, masks, presets, export, states, errors, naming, updates, layouts
```

## The idea in a few lines

- **Sort along any angle without rotating the image.** Pixels are partitioned into staircase lines with
  `k = y − round(x·tanθ)` — a pure permutation, so no lossy rotate-and-crop and no transparent corners.
- **Watch the sort itself.** Stable, visible algorithms (odd-even, insertion, merge) advance a step at a time on
  the same buffer; the last frame is guaranteed to equal the instant result.
- **Regions, not reassembly.** Masks and geometric segmentation are one idea: a map of cells and classes, each
  class free to freeze, turn, re-key or re-cut. One pass, one buffer, no seams.
- **Everything runs on your device.** The server serves files and stores results; it never touches pixels.

## Credits

The technique descends from [satyarth/pixelsort](https://github.com/satyarth/pixelsort) (MIT) and, before it,
Kim Asendorf's *ASDF Pixel Sort* Processing script. Icons will use [Lucide](https://lucide.dev). Mockup type is
[Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) and
[DM Mono](https://fonts.google.com/specimen/DM+Mono).

## License

[MIT](LICENSE) © 2026 Autumn Brown
