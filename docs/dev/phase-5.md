# Phase 5: the real UI

**Goal.** The SvelteKit app: Studio on desktop, the same instrument on a phone, Settings, and the Archive
screen, built on the engine from phases 1 to 4. It is a **port**, not a redesign: the mockups in `mockups/` are
the finished design and `mockups/tests/` are the acceptance tests.

**How to port.** Open the mockup file a task names and read it as the specification (markup, CSS, behaviour). Keep
names, wording and numbers. Then rebuild it as typed modules and Svelte components. Do **not** copy the mockup
code blindly: it is plain JavaScript with inline styles and global state. Do not port the mockup-only machinery
(decision W3): URL switches (`?used=`, `?error=`, `?update=`, `?runs=`, `?empty`, `?first`), "mockup only" chips,
the fake link-failure words, the fake runs generator as a data source, `localStorage` as a database.

**Depends on.** Phases 2, 3, 4 (engine and worker). The Archive talks to a storage interface that is
`localStorage` here and the server in phase 6. Regions, masks and custom shapes are phase 7 (the Pro panel is a
shell with the parts that do not need them).

**Exit criteria.**
1. Every mockup test has a real counterpart that passes (table at the end of this file).
2. `pnpm --dir web test`, `check`, `lint` and `make e2e` all pass; layout scan clean at all sizes.
3. Studio works end to end on a desktop and in a phone-sized viewport: load a picture, sort, animate, rename,
   export, change settings.
4. No network request to a third party at runtime (fonts and icons are vendored).

Branch: `build/phase-5`.

---

## Conventions for this phase

- **Pure modules** go in `web/src/lib/<name>.ts` with a `<name>.test.ts` next to them, named after the mockup
  module (`presets`, `export-model`, `states`, `errors`, `naming`, `runs-data`, `virtual-list`, `settings`,
  `help`, `updater`, `region-cards` in phase 7). Port the *assertions* of the matching mockup test.
- **Components** go in `web/src/lib/components/`, **routes** in `web/src/routes/`. Components take typed props
  and emit callbacks; they hold no business rules (those live in the pure modules).
- **Stores** (Svelte 5 runes in `.svelte.ts`) for app state: `engine.svelte.ts` (the client, params, run state),
  `settings.svelte.ts`, `studio.svelte.ts` (current picture, name, preset, overlays).
- **Storage interface** (`web/src/lib/storage.ts`): `get/set/remove(key)`, `listRuns`, etc. with a
  `LocalStorageBackend` now and a `ServerBackend` in phase 6. Pure modules never touch `localStorage`.
- **CSS:** port `mockups/shared/theater.css` into `web/src/lib/styles/theater.css` as design tokens and base
  rules, then component-scoped styles in the `.svelte` files. **Prefix every shared class** (`xd-`, `st-`, `hp-`,
  `er-`, `tour-`, `nm-`, `up-`) as the mockups did: class collisions bit the mockups four times. Before naming a
  class, search the host page's CSS.
- **Never** use `{@html}` for text a user can influence (run names, file names, URLs, SVG). Render as text. The
  naming and errors tests check this.
- **Accessibility:** real `<button>`s and labels, visible focus rings, 44 px targets on the phone layout,
  `prefers-reduced-motion` and the Settings "Always reduce" switch, `aria-live` for status text.

---

## A. Foundation

### P5-T01 · Design tokens, fonts, icons, app shell

**Files.** `web/src/lib/styles/theater.css`, `web/static/fonts/*`, `web/src/app.css`,
`web/src/routes/+layout.svelte`, `web/src/lib/components/TopBar.svelte`, `web/src/lib/components/Grain.svelte`.

**Spec.**
- Port the tokens and base rules of `mockups/shared/theater.css` (colours `--ink`, `--paper`, `--ver`, `--gold`,
  `--dim`, `--faint`, fonts, `--ease`, the `.btn` family, `.chips`, `.tog`/`.sw` switch, `.eyebrow`, `.display`).
- **Vendor the fonts** (decision W2): download Instrument Serif (regular, italic) and DM Mono (400, 500) as `woff2`
  from their official sources into `web/static/fonts/`, with their SIL OFL licence texts alongside, and
  `@font-face` them. **No `fonts.googleapis.com` anywhere.**
- Icons: `@lucide/svelte`, one import per icon. Replace the mockups' hand-drawn inline SVGs with the matching
  Lucide icons (gear = `settings`, help = `circle-help`, etc.). The angle dial, region tiles and shape previews stay
  custom (they draw the engine's concepts).
- App shell: the top bar (wordmark, readout slot, links), film-grain overlay and vignette driven by Settings
  (`html[data-grain]`, `html[data-motion]`, as `mockups/shared/settings.js` does).
- The top bar's Studio layout includes the Settings gear (see `mockups/studio.html`, `#bSet`).

**Tests first.** Vitest: none for CSS. Playwright `e2e/shell.spec.ts`: every request the page makes goes to the same
origin (collect `page.on('request')`, fail on any other host); fonts load (`document.fonts.check`); the grain
element exists and is hidden when `data-grain="off"`.

**Verify.** `pnpm --dir web check && pnpm --dir web test && make e2e`.

**Commit.** `Add design tokens, vendored fonts and app shell`

---

### P5-T02 · Settings, storage and the pure settings module

**Port of.** `mockups/shared/settings.js`, test `mockups/tests/help-settings.mjs` (settings parts).

**Files.** `web/src/lib/settings.ts`, `settings.test.ts`, `web/src/lib/storage.ts`, `storage.test.ts`,
`web/src/lib/settings.svelte.ts`.

**Spec.** `sanitize` (keep only known keys with valid values, clamp numbers), `workCopy(w, h, long)` (never
upscale, keep aspect), `DEVICE_RES`, defaults, exactly as the mockup. `storage.ts`: the interface plus
`LocalStorageBackend` that never throws when storage is unavailable or full (returns `false` from `set`) and treats
corrupt JSON as empty. The store applies `data-grain` and `data-motion` to `<html>`.

**Tests first.** Port every assertion in the "pure" section of `help-settings.mjs` (garbage dropped, clamped, corrupt
store reads empty, `workCopy` cases) plus: storage returns `false` instead of throwing when `setItem` throws
(stub it), and a damaged value reads as the default.

**Verify.** `pnpm --dir web test`.

**Commit.** `Add settings module and storage backend`

---

### P5-T03 · The engine store and the preview pipeline

**Files.** `web/src/lib/engine.svelte.ts`, `engine.svelte.test.ts` (logic parts), uses `EngineClient` from phase 2/3.

**Spec.** One store owns: the `EngineClient`, the current `Params`, the working image (`rgba`, `w`, `h`), run state
(`idle | preparing | animating | paused | done | error`), progress, stats, last timings. Behaviours (port of the
mockup's `PixelDemo` usage in `studio.html`):
- **Live preview:** while a control is being dragged, call `configure` then `run()` (instant) with latest-wins;
  on release, `reset` and replay as an animation if the user's mode is Animate.
- **Animate / Reveal / Live preview** are the three live modes of PLAN.md 3.7 (Reveal = the `reveal` algorithm).
- Params changes are coalesced (one `configure` per animation frame at most).
- Errors from the engine become a typed error code for the errors module (P5-T07), never a raw string in the UI.

**Tests first.** With a fake `EngineClient`: dragging 20 times in a frame sends one configure and one run;
releasing triggers `reset`; an engine error maps to the `engine-failed` or `engine-crashed` code.

**Commit.** `Add engine store and preview pipeline`

---

## B. Pure modules (each is one task: port, test, commit)

Each task: **Files** `web/src/lib/<name>.ts` and `<name>.test.ts`; **Tests first** = the assertions of the named
mockup test, rewritten in Vitest, run to failure before porting; **Verify** `pnpm --dir web test`;
**Commit** as given.

| Task | Port of | Notes |
|---|---|---|
| **P5-T04** presets | `shared/presets.js`, `tests/presets.mjs` | The 8 built-ins as data in **per-mille units** (decision E4: convert Python pixel lengths with reference width 2000); `roll()` re-rolls on every apply; `diff()` drives the "edited" tag. Seeded generator injectable. Also write `web/src/lib/presets.json` as the single source and load it in a Go test (`engine/presets_test.go`) to check every built-in rolls to valid `Params`. Commit `Add presets module` |
| **P5-T05** export model | `shared/export-model.js`, `tests/export.mjs` (planner part) | Memory planner, banding, device warnings, "Export at 75%" suggestion, filename builder (name, recipe, tag; drops a recipe word the name already contains). Keep the 8 B/px floor + 9 B/px scratch numbers and the 300 MB phone / 2000 MB desktop budgets, as constants with a comment that they are estimates. Commit `Add export planner` |
| **P5-T06** states | `shared/states.js`, `tests/states.mjs` | Storage 80% and 100% (still saves, never deletes), offline, empty. Pure `usage()`, `status()`, `segments()`. Commit `Add app states module` |
| **P5-T07** errors | `shared/errors.js`, `tests/errors.mjs` | The 11-code catalog: `describe(code, ctx)` returns title, body, what is safe, actions, exactly one primary. Never "undefined" or "NaN" in any text for any context (table-driven). Commit `Add error catalog` |
| **P5-T08** naming | `shared/naming.js`, `tests/naming.mjs` (pure part) | `clean`, `suggest`, `resolve`, `fileName`, store sanitising. Commit `Add naming module` |
| **P5-T09** runs data and virtual list | `shared/runs-data.js`, `shared/virtual-list.js`, `tests/scale.mjs` (pure part) | Dated rows, filter, jump index, virtual window maths. Port tests including 2000-run cases. Commit `Add runs data and virtual list` |
| **P5-T10** help data | `shared/help.js` (the `SHORTCUTS` table) | One typed table that the sheet renders **and** that a test iterates (see P5-T15). Commit `Add shortcut table` |
| **P5-T11** updater model | `shared/updater.js`, `tests/updater.mjs` (pure part) | `deriveView`, `blockReason`, `validRequest`, `staleTab`, `ready` flag logic, the exact states and texts. Behind an `UpdateClient` interface (`getVersion`, `getAvailable`, `getStatus`, `check`, `start`) with a **fake** implementation for tests; the real HTTP client is phase 8. Commit `Add updater model` |

---

## C. Studio (desktop)

Spec for every task here: the matching region of `mockups/studio.html` and its tests.

### P5-T12 · Stage, dock and popovers

**Files.** `web/src/routes/studio/+page.svelte`, `web/src/lib/components/Stage.svelte`, `Dock.svelte`,
`Knob.svelte`, `Popover.svelte`, `Readout.svelte`.

**Spec.** The stage (picture centred, canvas pair for original/sorted so Compare is instant), the floating dock of
knobs (Preset, Intervals, Length, Unsorted, Sort by, Direction, Watch as, Speed, plus the transport), each knob
opening one popover with its controls. The studio is **one container**: stage and dock live in one workspace that
resizes with one transition when the Pro panel opens (a bug the mockup fixed; keep it fixed). The dock tightens in
two steps via container queries and scrolls sideways as a last resort; it must never overflow the viewport. The
centred readout hides below **1440 px** (found in the mockup layout scan). Below ~700 px, the phone layout takes over
(P5-T20).

**Tests first.** Playwright `e2e/studio-layout.spec.ts`: port `mockups/tests/layout-scan.mjs` for the Studio page at
sizes 840x627, 1024x720, 1280x800, 1366x768, 1440x900, 1920x1080, 390x844: no horizontal page scroll, dock and
top bar inside the viewport, readout never collides with links.

**Commit.** `Add Studio stage and dock`

---

### P5-T13 · The angle dial

**Port of.** `mockups/shared/angle-dial.js`.

**Files.** `web/src/lib/components/AngleDial.svelte`, `web/src/lib/angle.ts`, `angle.test.ts`.

**Spec.** One free-form dial, any whole degree 0 to 359: drag, type, nudge with arrow keys, preset buttons, Shift
snaps to 15. The arrow shows the sort direction (0 = left to right, 90 = bottom to top, as decision E3). Dragging
produces the live preview, releasing replays. Pure `angle.ts`: `fromPointer(cx, cy, x, y)`, `snap15`, `wrap`.

**Tests first.** `angle.test.ts`: pointer positions at the four cardinal points give 0, 90, 180, 270 (note screen y
grows downward); `wrap(-1) == 359`, `wrap(360) == 0`; `snap15(7) == 0`, `snap15(8) == 15`. Playwright: dragging the
dial changes the knob value; typing 45 sets 45; arrow keys step by 1 and Shift+arrow by 15.

**Commit.** `Add angle dial`

---

### P5-T14 · Intake, working copy, compare, "what can move"

**Files.** `Intake.svelte`, `web/src/lib/intake.ts`, `intake.test.ts` (extend phase 2's `image-intake.ts`), `Peek.svelte`.

**Spec.**
- Intake (`N`): choose, drop, paste a file, paste a link, with a recents row. Dropping or pasting an image works
  anywhere in Studio. A dropped `.svg` is a *shape* (phase 7), not the picture. Files are decoded with
  `createImageBitmap` (EXIF orientation respected); failures map to the error catalog (`image-unreadable`,
  `image-too-big` using the device pixel budget).
- URL loading: try a direct `fetch` first; on a CORS failure use the server relay (`POST /api/fetch`, phase 6b).
  Until then, the relay call goes through a `Fetcher` interface whose default says "needs the server" via the
  `link-blocked` error. Map the four link failures (`link-blocked`, `link-not-image`, `link-too-large`,
  `link-timeout`) to their catalog codes.
- **Compare:** holding `C` shows the original.
- **What can move** (`T`): an overlay of which pixels the current recipe allows to sort. It must *agree with the
  engine*: ask the engine (`session.Sortable()`: add `func (s *Session) Sortable() []uint8` returning 1 where a pixel is
  in some interval and 0 elsewhere, plus a test that it equals "pixels covered by `Plan.Intervals`"), never recompute
  rules in TypeScript.

**Tests first.** Port `mockups/tests/peek.mjs` (overlay agrees with sorting: every pixel the overlay marks "held" is
unchanged after a sort, and every changed pixel is marked "can move"); `intake.test.ts` for URL/file classification and
error-code mapping; Go test for `Sortable`.

**Commit.** `Add intake, compare and what-can-move overlay`

---

### P5-T15 · Help: shortcuts and the first-run tour

**Port of.** `mockups/shared/help.js`, `tests/help-settings.mjs`.

**Files.** `ShortcutSheet.svelte`, `Tour.svelte`, `web/src/lib/shortcuts.ts` (key handling, one dispatcher).

**Spec.** The sheet (`?`) renders the typed table from P5-T10. **One** key dispatcher handles every shortcut, ignores
keys while an input has focus, and stays quiet while a modal is open. The tour highlights real elements and must fit
every screen size (including phone). First run is detected from storage (`toured` flag); a "Take the tour" button in
Settings starts it.

**Tests first.** Port the whole of `help-settings.mjs`: *every shortcut in the table has a working probe and every
probe is in the table*; the sheet lists exactly the table in order; other shortcuts stay quiet while it is open;
the tour fits all sizes and can be skipped.

**Commit.** `Add shortcut sheet and tour`

---

### P5-T16 · Naming in Studio

**Port of.** the naming parts of `mockups/studio.html` and `tests/naming.mjs`.

**Files.** `NameField.svelte`, wiring in Studio.

**Spec.** Click or tap the name under the picture (or `F2`): an inline field with Save and Auto, showing the file
name it will export as; Enter or blur saves, Esc undoes, empty goes back to the automatic name, 60 characters,
control characters stripped, shown as text only. Renaming an opened run renames it in the filmstrip and the Archive
(through storage). The edit box opens *below* the picture and never overlaps the dock at any size.

**Tests first.** Port `naming.mjs` (browser part): all the Studio steps, the dock-clearance check at four sizes,
markup is shown as text.

**Commit.** `Add renaming in Studio`

---

### P5-T17 · Runs strip (filmstrip)

**Port of.** the strip in `mockups/studio.html` and `tests/scale.mjs` (Studio part).

**Files.** `Strip.svelte`, `VirtualList.svelte`.

**Spec.** A column of past runs (`G`), dated rows, virtualised, searchable, with a jump rail; opening a run restores
its recipe and shows its name. Reads from the storage interface (`listRuns` with paging). Far jumps are instant
(smooth scrolling misbehaves on long virtual lists).

**Tests first.** Port the Studio part of `scale.mjs` with a seeded fake storage of 2000 runs: only a window of rows is
in the DOM, search narrows, jump rail lands on the right date, keyboard focus works.

**Commit.** `Add runs strip`

---

### P5-T18 · Export dialog and the error surfaces

**Port of.** `mockups/shared/export-dialog.js`, `shared/errors.js` (UI part), `tests/export.mjs`, `tests/errors.mjs`.

**Files.** `ExportDialog.svelte`, `ErrorDialog.svelte`, `ErrorBanner.svelte`, `StatusPill.svelte`.

**Spec.** Export runs the **real** engine on the full-resolution image in line bands (the planner decides the band
count): the worker sorts band by band and the page shows banded progress with Cancel. Format PNG/JPEG/WebP, quality,
strip metadata, embed recipe (PNG text chunk or WebP/JPEG comment: write one small encoder helper per format and
test that the recipe round-trips), "Export at 75%" suggestion, device warning. Encoding uses `canvas.toBlob`.
Failures use the catalog: blocking dialogs for load/engine errors, a non-blocking banner for background failures
(save, share). The status pill shows storage and offline states (P5-T06).

> **Banding note.** The engine needs a banded entry point: add `Plan` support for sorting a range of lines
> (`func (pl *Plan) SortLines(dst *Image, from, to int)`), with a property test that sorting all bands in any order
> equals `Sort()`, and add `sortBand(from, to)` to the session API and WASM binding. Do this as a separate commit
> first: `Add banded sorting`.

**Tests first.** Port `export.mjs` (planner properties, banded progress, device warnings in Studio and phone) and
`errors.mjs` (catalog rules; every failure on every screen: what it says, what is safe, what the buttons do), with
the failures triggered by real conditions (a text file as a picture, `maxPixels` reduced via a test hook) instead of
URL words.

**Commit.** `Add export dialog and error surfaces`

---

### P5-T19 · Settings page and Updates block

**Port of.** `mockups/settings.html`, `shared/updater.js` (UI part), `tests/help-settings.mjs` (settings),
`tests/updater.mjs` (page part).

**Files.** `web/src/routes/settings/+page.svelte`, `UpdatesBlock.svelte`, `UpdateDot.svelte`.

**Spec.** All sections of the mockup: Picture (working copy size with the live note), Export defaults, Sharing,
Look and motion, Storage, Your presets (delete), Help, **Updates**, About and credits. Grain and motion really apply
to every page. The Updates block renders `deriveView` from P5-T11 against an injected `UpdateClient`; until phase 8 the
injected client is a stub that reports "updates are not set up". The **update dot** shows on every way into Settings
(Studio gear, phone gear, Archive link) when an update is ready; it never starts a check.

**Tests first.** Port the Settings and Updates browser tests with the *fake* `UpdateClient` driven through every
scenario (available, fail, rollback failed, none, stale, silent), including the dot behaviour across pages
(one browser context) and Update being disabled while an export runs.

**Commit.** `Add Settings page and update block`

---

## D. Phone

### P5-T20 · Phone Studio

**Port of.** `mockups/phone.html`, `tests/export.mjs` and `tests/peek.mjs` (phone parts), `tests/phone-mask.mjs` (later).

**Files.** `web/src/lib/components/phone/*`, `Sheet.svelte` (bottom sheet: peek, half, full), tabs Cut, Sort,
Direction, Protect (phase 7), Shapes (phase 7), Runs.

**Spec.** Below ~700 px the Studio route renders the phone layout: stage on top, the dock folded into the bottom
sheet with the same controls and the same stores, a preset rail, the angle dial, threshold/edge/cellular controls
on the Cut tab, the Runs tab with 3-up dated rows. Switches get a 44 px hit area. Share the components and modules
with desktop; only the container differs.

**Tests first.** Playwright at 390x844: sheet states, 44 px target check for every button in the sheet (hit-test the
`::before` area for switches), nothing overflows sideways, export dialog fits as a sheet, every tab reachable by touch.

**Commit.** `Add phone Studio`

---

## E. Archive shell

### P5-T21 · Archive screen

**Port of.** `mockups/gallery.html`, `tests/scale.mjs` (Archive part), `tests/states.mjs` (Archive part).

**Files.** `web/src/routes/archive/+page.svelte`, `Frame.svelte`, `Viewer.svelte`, `ShareDialog.svelte` (UI only).

**Spec.** The wall of frames, usage meter with the 80% mark, tabs All / Starred / Albums / Bin, "Free up space"
smart select (never sweeps in starred runs), bulk dock, full-screen viewer with the recipe as a "slate" and arrow-key
paging, rename in the viewer (P5-T16 component), Bin with days-left badges. All data comes from the storage
interface (`LocalStorageBackend` for now); trash/restore/empty and share actions call interface methods that
phase 6 and 6b implement. Albums tab and the share dialog are UI over the `shares` interface (a fake until 6b).

**Tests first.** Port the Archive parts of `scale.mjs` and `states.mjs` and the viewer behaviours (Esc ends a rename
before closing the viewer, arrows do not page while typing).

**Commit.** `Add Archive screen`

---

## F. Pro panel shell and finishing

### P5-T22 · Pro panel shell, histogram, rule browser

**Spec.** `Tab` opens the Pro panel (pushes the stage on windows >= 1240 px, overlays below, with a scrim). Contents
available now: threshold histogram (computed in the worker from the working copy: add `func (s *Session) Histogram(key SortKey) [256]int`
with a test), the CA rule browser with the recommended rules and notes from phase 4 (`RuleNote`), and an empty
"Regions" section that says it arrives with phase 7 (hidden behind a flag until then).

**Tests first.** Histogram counts sum to `w*h`; `Tab` toggles the panel; the panel never squeezes the picture into a
thumbnail (assert picture width at 1024 and 1440).

**Commit.** `Add Pro panel shell`

---

### P5-T23 · Layout scan, accessibility pass, and the acceptance table

**Spec.** Port `mockups/tests/layout-scan.mjs` as a Playwright test over every route and state at 840x627, 1024x720,
1280x800, 1366x768, 1440x900, 1920x1080 and 390x844. Add an accessibility check with `@axe-core/playwright` on each
route (no serious or critical violations). Fill the table below in `docs/dev/NOTES.md` with the status of each row.

| Mockup test | Real test | Status |
|---|---|---|
| `engine-properties.mjs`, `region-properties.mjs` | Go properties (phases 1, 3, 4, 7) | |
| `presets.mjs` | `presets.test.ts` + `e2e/presets.spec.ts` | |
| `export.mjs` | `export-model.test.ts` + `e2e/export.spec.ts` | |
| `peek.mjs` | `e2e/peek.spec.ts` | |
| `states.mjs` | `states.test.ts` + `e2e/states.spec.ts` | |
| `help-settings.mjs` | `settings.test.ts` + `e2e/help.spec.ts` | |
| `errors.mjs` | `errors.test.ts` + `e2e/errors.spec.ts` | |
| `scale.mjs` | `runs-data.test.ts` + `e2e/scale.spec.ts` | |
| `naming.mjs` | `naming.test.ts` + `e2e/naming.spec.ts` | |
| `updater.mjs` | `updater.test.ts` + `e2e/updater.spec.ts` | |
| `layout-scan.mjs` | `e2e/layout.spec.ts` | |
| `region-algo.mjs` | Go (phase 3) + `e2e/animate.spec.ts` | |
| `region-cards.mjs`, `shape-*.mjs`, `custom-shapes.mjs`, `mask-editor.mjs`, `phone-mask.mjs` | phase 7 | |

**Commit.** `Add layout scan and accessibility checks`

---

### P5-T24 · Phase wrap-up

Run everything: `make check`, `make test`, `make wasm-test`, `pnpm --dir web check lint test`, `make e2e`. Tick
`PROGRESS.md`. In `NOTES.md` list any mockup behaviour you could not port and why. Do **not** delete `mockups/`
(it stays as the reference).

**Commit.** `Finish phase 5`
