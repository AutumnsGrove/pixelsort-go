# Mockup tests

Browser tests for the throwaway mockups. They run in headless Chromium against the static pages, so there is
nothing to build or serve.

```bash
pnpm install
pnpm exec playwright install chromium   # once
pnpm test                               # everything
pnpm run masks                          # or one suite: engine | regions | shapes | masks | phone | layout
```

| Suite | What it proves |
|---|---|
| `engine-properties` | For 15 angles x 6 interval modes x 4 image shapes (incl. 1xN and Nx1): the staircase line partition covers every pixel exactly once, sorting only rearranges pixels, every interval ends sorted, and the animated stepper ends on the instant result. |
| `region-properties` | 7 tilings x 4 class patterns x 2 sizes with frozen / re-angled / re-keyed classes: full coverage, frozen pixels never move, no interval crosses a cell, stepper == instant. |
| `custom-shapes` | SVG parsing (good files, bad files, multi-subpath), plus 32 configurations of custom tilings with per-region cutting modes. |
| `mask-editor` | Real mouse input on the Studio: add, drag, corner-resize, rotate (handle and typed), exact sizes, cut-a-hole, invert, Delete, brightest-spot, loop-then-snap. |
| `phone-mask` | The same editable shapes on the phone sheet. |
| `layout-scan` | Every screen at 840, 1024, 1920 and 390 px wide: no horizontal overflow, nothing cut off, no top-bar collisions. |

These test the **mockup stand-in**, not the Go engine. The same properties are the spec for the Go engine's
tests (see `PLAN.md` section 8) — port them, don't discard them.
