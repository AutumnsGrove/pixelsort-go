# Conventions

## Layout (final)

```
pixelsort-go/
├── go.mod                       module github.com/AutumnsGrove/pixelsort-go, go 1.27
├── Makefile  .golangci.yml  .gitignore  .editorconfig
├── engine/                      PURE Go. No I/O, no globals, no syscall/js, no net, no os.
│   ├── engine.go                package doc, EngineVersion
│   ├── image.go                 Image type, Pack/Unpack, conversions
│   ├── params.go                Params, enums, defaults, Validate, JSON
│   ├── rng.go                   SplitMix64 streams
│   ├── fixed.go                 integer-only helpers (sine, lerp)
│   ├── keys.go                  sort keys
│   ├── lines.go                 scanline partition (any angle)
│   ├── regions.go               region map, class definitions
│   ├── intervals.go             cut/freeze, every interval mode except ca
│   ├── edges.go                 Laplacian edge map
│   ├── ca.go                    cellular automata
│   ├── plan.go                  Plan: keys + lines + intervals, built once
│   ├── sorter.go                instant sort (stable counting sort)
│   ├── stepper.go               animated algorithms
│   ├── feather.go               soft-mask blend
│   ├── shapes/                  tessellations, polygon fill, SVG-ring helpers (phase 7)
│   └── testdata/                goldens, fuzz corpora, rapid failfiles
├── internal/testutil/           test helpers shared by packages (images, golden files)
├── cmd/
│   ├── pixelsort-go/            cobra CLI: serve, render, version
│   └── wasm/                    syscall/js bindings (build tag js && wasm)
├── server/                      gallery API, storage, trash, share relay, embed (phase 6+)
├── worker/                      Cloudflare Worker, TypeScript, wrangler project (phase 6b)
├── web/                         SvelteKit app, TypeScript (phase 5+)
├── deploy/                      Dockerfile, compose, watcher scripts, .env.example (phase 8)
├── docs/  mockups/  PLAN.md  README.md  LICENSE
```

`engine/` may import only the standard library (and `pgregory.net/rapid` in tests). The server never imports
`engine` for pixel work; the server never touches pixels.

## Go standards

**Formatting and tooling.** `gofmt` and `goimports` clean (CI fails otherwise). `go vet`, `staticcheck` and
`golangci-lint` clean. The lint config is in `.golangci.yml` (see Phase 0). Do not silence a linter with
`//nolint` unless you add the reason on the same line.

**Naming.** Short, clear, no stutter (`engine.Params`, not `engine.EngineParams`). Acronyms are all caps
(`ID`, `URL`, `RGBA`, `JSON`). Test files end `_test.go`. Receivers are one or two letters and consistent.

**Packages.** Small and cohesive. No `util` or `common` packages. No import cycles. Accept interfaces,
return concrete types. Define an interface where it is *used*, not where it is implemented.

**Errors.** Return `error`; wrap with context: `fmt.Errorf("plan: compute keys: %w", err)`. Compare with
`errors.Is` / `errors.As`. Sentinel errors are `var ErrX = errors.New("...")`, lowercase messages, no
punctuation. Never `log.Fatal` or `os.Exit` outside `main`. Never panic for bad input; panic only for
impossible states that a test would catch.

**State.** No package-level mutable variables. Constants and read-only tables are fine. Pass dependencies in.
Everything in `engine/` is a pure function of its inputs.

**Concurrency.** The engine is single-goroutine (Go WASM is single-threaded; parallelism is a pool of Web
Workers, not goroutines). The server uses `context.Context` as the first parameter of anything that does I/O,
closes what it opens (`defer`), and has no goroutine without an owner and a way to stop it.

**API shape.** Validate at the boundary (`Params.Validate()`), then trust the types inside. Exported structs
that cross the JSON boundary have explicit `json` tags and a documented zero value.

**Comments.** Every exported identifier has a doc comment starting with its name. Comments say why. Keep
the PLAN.md section number in comments where behaviour comes from it (`// PLAN.md 3.3`).

**Tests.** Table-driven, with `t.Run` names that read as sentences. `t.Helper()` in helpers. `t.Parallel()` in
tests that share no state. Test data in `testdata/`. No sleeps; no network; no wall-clock time. Details in
`testing.md`.

## Determinism rules (engine only; these make golden hashes stable on every machine)

The same recipe must give a byte-identical image on a Mac (arm64), a CI runner (amd64) and in the browser
(WASM). Three things break that, so three rules:

1. **No `math/rand`, no `math/rand/v2`, no `crypto/rand`, no `time`.** All randomness comes from
   `engine.RNG` (SplitMix64), seeded per line: `NewStream(seed, lineID)`. Same `(seed, lineID)` gives the same
   numbers forever, on every platform.
2. **No floating point in anything that decides *where a pixel goes*.** Cut positions, thresholds, interval
   lengths, region membership, line geometry and sort keys use integers (fixed point where needed; see
   `reference/primitives.go.txt`). The few places that need a float (computing the slope table for the 360
   integer angles, once) wrap every product in an explicit `float64(...)` conversion, because arm64 may
   otherwise fuse `a*b+c` into one instruction (FMA) and round differently from amd64. A test pins the
   resulting table.
3. **Never let map iteration order or goroutine scheduling reach the output.** Iterate slices, or sort map
   keys first.

Feather and soft masks blend with integer math too (`(p*(255-a) + q*a + 127) / 255`).

## TypeScript standards (web/ and worker/)

- `strict: true`, `noUncheckedIndexedAccess: true`. No `any` (use `unknown` and narrow). No non-null `!`
  unless a comment says why it cannot be null.
- Svelte 5 with runes (`$state`, `$derived`, `$effect`). One component per file; props typed.
- Pure logic lives in plain `.ts` modules under `web/src/lib/` with Vitest tests; components stay thin.
  This is how the mockups are built too (`mockups/shared/*.js` are the pure modules).
- Formatting: Prettier. Lint: ESLint with `typescript-eslint` and `eslint-plugin-svelte`.
- No untyped JSON: parse into a type with a runtime check (a small hand-written validator, or `zod` if it
  is already in use).
- Never inject untrusted strings as HTML (`{@html}` is banned except for content you generated). User text
  such as run names is always rendered as text. The mockups' tests check this; keep that behaviour.
- Accessibility is a requirement, not polish: real buttons, labels, focus rings, 44 px touch targets on the
  phone layout, `prefers-reduced-motion`. The mockup tests encode these; port them.

## Dependencies

Intended, and enough for the whole plan:

| Where | Package | For |
|---|---|---|
| Go | `github.com/spf13/cobra` | CLI |
| Go | `modernc.org/sqlite` | gallery database, pure Go, no CGO |
| Go | `pgregory.net/rapid` | property tests (test-only) |
| Web | `@sveltejs/kit`, `@sveltejs/adapter-static`, `svelte`, `typescript`, `vite` | the app |
| Web | `vitest`, `@playwright/test` | unit and browser tests |
| Web | `@lucide/svelte` | icons (one import per icon) |
| Worker | `wrangler`, `vitest` (+ the Workers pool) | the share Worker and its tests |

Everything else is the standard library. Go module versions are pinned by `go.sum`; `pnpm-lock.yaml` is
committed.

## Repo hygiene

- `.gitignore`: `web/build`, `web/.svelte-kit`, `node_modules`, `*.wasm`, `coverage.out`, `dist/`, `.env`,
  `data/`.
- No secrets, tokens or personal data in the repo. Config comes from environment variables; `.env.example`
  lists names with fake values.
- Line endings LF. `.editorconfig`: UTF-8, final newline, tabs for Go, two spaces for everything else.
