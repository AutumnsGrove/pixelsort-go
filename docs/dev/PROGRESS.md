# Progress

Tick a box (`[ ]` to `[x]`) in the **same commit** as the work. Tasks marked **[HUMAN]** are Autumn's: the build agent skips them and notes them in `NOTES.md`. Work top to bottom within a phase; the order below is the dependency order.

## Phase 0: repo, tooling, and a hello-world WASM

File: [`phase-0.md`](phase-0.md)

- [x] P0-T01 Module, repo hygiene, engine stub
- [x] P0-T02 Version package and CLI root
- [x] P0-T03 Cross-origin isolation middleware and static handler
- [x] P0-T04 Lint config and Makefile
- [x] P0-T05 A fuzz target, so `make fuzz` has something to run
- [x] P0-T06 The engine as WebAssembly, under Node
- [x] P0-T07 The browser spike: worker, page, isolation report
- [x] P0-T08 CI
- [ ] P0-T09 [HUMAN] Check the headers survive `tailscale serve`
- [x] P0-T10 Repo docs and bookkeeping

## Phase 1: the engine, native Go

File: [`phase-1.md`](phase-1.md)

- [x] P1-T01 Image type
- [x] P1-T02 RNG and integer helpers
- [x] P1-T03 Parameters
- [x] P1-T04 Sort keys
- [x] P1-T05 Line partition
- [x] P1-T06 Regions: types and region-aware lines
- [x] P1-T07 Test helpers and generators
- [x] P1-T08 Edge map
- [x] P1-T09 Plan: keys, lines and intervals
- [x] P1-T10 The instant sorter
- [x] P1-T11 Feather
- [x] P1-T12 Goldens, benchmarks and the cross-platform check
- [x] P1-T13 The render command
- [x] P1-T14 Phase wrap-up

## Phase 2: the engine in the browser, and the numbers

File: [`phase-2.md`](phase-2.md)

- [x] P2-T01 The session API (pure Go)
- [x] P2-T02 The WASM binding
- [x] P2-T03 The web app scaffold
- [x] P2-T04 Worker, protocol and client
- [x] P2-T05 The lab page
- [x] P2-T06 Measure: zero-copy or copy, and what a pass costs
- [x] P2-T07 WASM equals native
- [x] P2-T08 Browser smoke test and CI
- [x] P2-T09 Phase wrap-up

## Phase 3: watch the sort happen

File: [`phase-3.md`](phase-3.md)

- [x] P3-T01 Stepper skeleton and odd-even transposition
- [x] P3-T02 Insertion
- [x] P3-T03 Bottom-up merge
- [x] P3-T04 Reveal
- [x] P3-T05 Mixed algorithms and progress
- [x] P3-T06 Soft blend while stepping
- [x] P3-T07 Session API: step, progress, reset
- [x] P3-T08 Animate in the worker and the lab
- [x] P3-T09 Measure the pass cost
- [x] P3-T10 Phase wrap-up

## Phase 4: cellular-automaton intervals

File: [`phase-4.md`](phase-4.md)

- [x] P4-T01 The automaton
- [x] P4-T02 The two interval modes
- [x] P4-T03 Line space
- [x] P4-T04 Rule catalogue
- [x] P4-T05 Goldens, benchmarks, WASM
- [x] P4-T06 Phase wrap-up

## Phase 5: the real UI

File: [`phase-5.md`](phase-5.md)

- [x] P5-T01 Design tokens, fonts, icons, app shell
- [x] P5-T02 Settings, storage and the pure settings module
- [x] P5-T03 The engine store and the preview pipeline
- [x] P5-T04 Port presets
- [x] P5-T05 Port export model
- [x] P5-T06 Port states
- [x] P5-T07 Port errors
- [x] P5-T08 Port naming
- [x] P5-T09 Port runs data and virtual list
- [x] P5-T10 Port help data
- [x] P5-T11 Port updater model
- [x] P5-T12 Stage, dock and popovers
- [x] P5-T13 The angle dial
- [x] P5-T14 Intake, working copy, compare, "what can move"
- [x] P5-T15 Help: shortcuts and the first-run tour
- [x] P5-T16 Naming in Studio
- [x] P5-T17 Runs strip (filmstrip)
- [x] P5-T18 Export dialog and the error surfaces
- [x] P5-T19 Settings page and Updates block
- [x] P5-T20 Phone Studio
- [x] P5-T21 Archive screen
- [x] P5-T22 Pro panel shell, histogram, rule browser
- [x] P5-T23 Layout scan, accessibility pass, and the acceptance table
- [x] P5-T24 Phase wrap-up

## Phase 6: the gallery server

File: [`phase-6.md`](phase-6.md)

- [x] P6-T01 Config
- [x] P6-T02 Database and migrations
- [x] P6-T03 Blob store
- [x] P6-T04 HTTP foundations
- [x] P6-T05 Create a run
- [x] P6-T06 Read, list, update
- [x] P6-T07 Trash, restore, empty
- [x] P6-T08 Usage
- [x] P6-T09 Presets, settings, shapes
- [x] P6-T10 Serving images
- [x] P6-T11 Health, version, SPA, security headers
- [x] P6-T12 Wire it together: app and `serve`
- [x] P6-T13 `docs/api.md`
- [x] P6-T14 The web `ServerBackend` and auto-save
- [x] P6-T15 Phase wrap-up

## Phase 6b: the Cloudflare Worker (share links and URL loading)

File: [`phase-6b.md`](phase-6b.md)

- [x] P6B-T01 Worker scaffold
- [x] P6B-T02 Request signing (both languages)
- [x] P6B-T03 Album upload and revoke
- [x] P6B-T04 The public viewer and file routes
- [x] P6B-T05 Scheduled expiry sweep
- [x] P6B-T06 URL loading relay
- [x] P6B-T07 The potato side: client, tables, API
- [x] P6B-T08 Web: share dialog, Albums, URL loading
- [ ] P6B-T09 [HUMAN] Cloudflare setup and deploy
- [x] P6B-T10 Phase wrap-up

## Phase 7: regions, masks and custom shapes

File: [`phase-7.md`](phase-7.md)

- [x] P7-T01 Tessellation core: square, diamond, circle, octagon
- [x] P7-T02 Hexagon, triangle, Voronoi
- [x] P7-T03 Custom polygons with holes
- [x] P7-T04 Classes and patterns
- [x] P7-T05 Region properties and goldens
- [x] P7-T06 Masks: objects, strokes, invert, brightest spot
- [x] P7-T07 Session API and WASM for regions
- [x] P7-T08 TypeScript geometry modules
- [x] P7-T09 Pro panel: Regions
- [ ] P7-T10 Region cards
- [x] P7-T11 Protect: brush, objects, feather
- [ ] P7-T12 Shape library
- [ ] P7-T13 Phone: Protect and Shapes tabs
- [ ] P7-T14 Acceptance and wrap-up

## Phase 8: deploy, in-app updates, backups

File: [`phase-8.md`](phase-8.md)

- [x] P8-T01 `snapshot`, `healthcheck` and `starred-list` subcommands
- [x] P8-T02 Dockerfile
- [x] P8-T03 Compose and environment
- [x] P8-T04 CI: publish the image
- [x] P8-T05 Update endpoints in the server
- [x] P8-T06 The real update client in the web app, and the stale-tab banner
- [x] P8-T07 The watcher
- [x] P8-T08 Meridian snippets
- [x] P8-T09 Backups
- [x] P8-T10 Deployment docs
- [ ] P8-T11 [HUMAN] First deploy
- [ ] P8-T12 [HUMAN] Homelab documentation
- [x] P8-T13 Phase wrap-up

## Phase 9: polish and stretch

File: [`phase-9.md`](phase-9.md)

- [ ] P9-T01 Worker pool (parallel sort)
- [ ] P9-T02 Video recording of the animation
- [ ] P9-T03 Scrubbing and rewind
- [ ] P9-T04 More segmentations
- [ ] P9-T05 Mask morphology and multiple mask layers
- [ ] P9-T06 Batch processing
- [ ] P9-T07 Project export and import, shareable recipe links
- [ ] P9-T08 TinyGo experiment
- [ ] P9-T09 Detail / coarseness control
- [ ] P9-T10 Polish pass
