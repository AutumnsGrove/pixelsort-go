# Testing

Test-driven, always: **the test comes first and must fail first.** Tests are how this project says what
"correct" means, because there is no reference implementation to compare against (the Python original is
deliberately different; see PLAN.md section 8).

## The layers

| Layer | Tool | Lives in | Runs in `make check`? |
|---|---|---|---|
| Unit (table tests) | `testing` | `*_test.go` next to the code | yes |
| **Property tests** | `pgregory.net/rapid` | `*_prop_test.go`, functions named `TestProp_*` | yes (100 checks each) |
| **Fuzz tests** | native `go test -fuzz` | `*_fuzz_test.go`, functions named `FuzzXxx` | seed corpus only; `make fuzz` explores |
| Golden hashes | `internal/testutil` | `engine/testdata/golden/` | yes |
| Benchmarks | `testing.B` | `*_bench_test.go` | no (`make bench`) |
| WASM smoke | `GOOS=js GOARCH=wasm` under Node | `engine/*_test.go` + `web/scripts/` | no (`make wasm-test`, CI) |
| Web unit | Vitest | `web/src/**/*.test.ts` | no (`make web-test`) |
| Browser e2e | Playwright | `web/e2e/*.spec.ts` | no (`make e2e`) |

`make check` must stay fast (under about 60 seconds). Everything slower runs in `make test`, `make fuzz`
and CI.

## The TDD loop (what "tests first" means here)

1. Write a test that states the behaviour. Run it: `go test ./engine -run TestName`.
2. It must fail **because the behaviour is missing**: "undefined: X" or "got 3, want 5". If it fails for a
   typo or an import error, fix that and look again.
3. Write the least code that passes. Run the test. Then the whole package. Then `make check`.
4. Refactor with the tests green. Commit.

Property and fuzz tests count as tests: a task that says "write the properties first" means write them,
watch them fail (usually "undefined"), then implement.

## Unit tests

- Table-driven; each row has a `name` that reads like a sentence. Use `t.Run(tc.name, ...)`.
- Compare with `reflect.DeepEqual` or `slices.Equal` / `bytes.Equal`; on failure print got and want.
- Use tiny, hand-checkable inputs (a 5x3 image, three colours) as well as generated ones. When a rule is
  subtle (rounding, tie-breaking, direction), pin it with a hand-computed example and a comment showing
  the working.
- Edge sizes appear in every geometry test: `1x1`, `1xN`, `Nx1`, `2x2`, a prime-by-prime size such as `97x61`,
  and a square.

## Property tests (rapid)

A property is a rule that must hold for *every* input. `rapid` generates many inputs, then **shrinks** a
failing one to a small readable case. The skeleton:

```go
func TestProp_PartitionIsBijection(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := rapid.IntRange(1, 80).Draw(t, "w")
		h := rapid.IntRange(1, 80).Draw(t, "h")
		angle := rapid.IntRange(0, 359).Draw(t, "angle")
		lines := engine.Partition(w, h, angle)
		// every position 0..w*h-1 appears exactly once ...
	})
}
```

- Generators for the engine live in `internal/testutil` (`ImageGen`, `ParamsGen`, `RegionsGen`), so every
  property uses the same definition of "a random valid input".
- Run more checks locally with `go test ./engine -rapid.checks=2000`.
- When rapid finds a failure it writes a file under `testdata/rapid/<TestName>/`. **Commit those files**:
  they replay as permanent regression tests.
- `rapid.MakeFuzz` turns any property into a native fuzz target, so the fuzzer can also drive it:
  `f.Fuzz(rapid.MakeFuzz(func(t *rapid.T) { ... }))`.

### The engine's properties (PLAN.md section 8; every one has a test)

1. Every interval is sorted by its key, and **stable** on ties.
2. **Permutation:** the output is a rearrangement of the input: per interval, per line, overall.
3. **Frozen pixels never move** (masks, thresholds, frozen classes).
4. **Determinism:** same recipe + seed gives byte-identical output (run twice, compare).
5. **Stepper to completion equals instant**, for every algorithm x interval mode x angle.
6. **The line partition is a bijection** at every angle (each pixel in exactly one line).
7. **Region boundaries are never crossed** by an interval.
8. Oracle test: the instant sorter agrees with `sort.SliceStable` on every interval.

## Fuzz tests (native Go fuzzing)

Goal: find crashes, hangs and invariant breaks on inputs a person would never think of.

```go
func FuzzParamsJSON(f *testing.F) {
	f.Add([]byte(`{"mode":"random","angle":45}`))      // seeds: a few valid, a few nasty
	f.Add([]byte(`{"angle":-1}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		p, err := engine.ParseParams(data)
		if err != nil { return }                          // rejecting bad input is fine
		if err := p.Validate(); err != nil { t.Fatalf("parsed but invalid: %v", err) }
		// round trip: marshal and parse again, must be equal
	})
}
```

- Name `FuzzXxx`; one target per behaviour; always seed with `f.Add` (valid cases and the known awkward
  ones: sizes 1x1, 1xN, huge `length`, `randomness` 0 and 100).
- Supported argument types: `[]byte`, `string`, `bool`, `byte`, `rune`, `int*`, `uint*`, `float*`. For a
  structured input, take `[]byte` or ints and build the value inside (clamp to valid ranges; do not skip
  input just because it is out of range, clamp it).
- Keep each execution fast (under a few milliseconds): small images, bounded sizes.
- Fuzzing runs natively only (`GOOS=js` does not support it). WASM gets golden and smoke tests instead.
- Crashers go to `testdata/fuzz/FuzzXxx/<hash>`. **Commit them** after the fix; `go test` then replays
  them forever.
- `make fuzz` runs every `Fuzz*` target for 20 seconds each (a loop over `go test -list '^Fuzz'`, because
  `-fuzz` accepts one target per run). CI runs it for 10 seconds each; a nightly job can run longer.
- Targets the plan requires: `FuzzParamsJSON`, `FuzzFromRGBA`, `FuzzPartition` (any w, h, angle),
  `FuzzPlanAndSort` (random params and sizes: no panic, permutation, frozen untouched),
  `FuzzStepperEqualsInstant`, `FuzzRegionLabels`, `FuzzCARule` and, in the server, `FuzzImageUpload` and
  `FuzzRunsQuery`.

## Golden hashes

For a handful of fixed recipes on a fixed synthetic image, the sorted output's SHA-256 is stored in
`engine/testdata/golden/*.json`:

```json
{ "name": "random-45", "engine_version": "1", "params": { ... }, "w": 97, "h": 61, "sha256": "..." }
```

- `internal/testutil.Golden(t, name, got)` compares; `go test ./engine -run Golden -update` rewrites.
- A golden changes **only** when behaviour changes on purpose. In that commit, bump `EngineVersion` and
  say why in the commit body. A golden that changes by accident is a bug.
- The same hashes are checked on **arm64 (a developer's Mac), amd64 (CI) and WASM (under Node)**. If one
  platform disagrees, you have found a determinism bug (see `conventions.md`): fix the code, never the
  golden.
- The synthetic test image is generated by `testutil.Gradient(w, h, seed)` from integers only, so it is
  identical everywhere.

## Benchmarks

`go test ./engine -bench . -benchmem -run '^$'`. Cover: plan build, instant sort, one stepper pass, each at
1, 2, 8 and 24 megapixels (generate the image in setup). Results go in `docs/perf.md` (phase 2) with the
machine and Go version. Benchmarks never fail a build; a human reads them.

## WASM tests

```
GOOS=js GOARCH=wasm go test -exec="$(go env GOROOT)/lib/wasm/go_js_wasm_exec" ./engine/...
```

This runs the engine's own tests inside Node. (Verified on Go 1.27: the runner is at
`$(go env GOROOT)/lib/wasm/go_js_wasm_exec`; `wasm_exec.js` is in the same folder.) A separate Node script
in `web/scripts/` loads the built `engine.wasm` and checks it against the native goldens.

## Web tests

- **Vitest** for every pure module (`presets`, `export-model`, `states`, `errors`, `naming`, `updater`,
  `runs-data`, `virtual-list`, `settings`, `region-cards`): port the rules the matching mockup test checks.
- **Playwright** for flows: port `mockups/tests/*.mjs` one-to-one (same assertions, same names where
  possible). The mockup tests are the acceptance suite for the UI.
- Run Playwright against `vite preview` on a fixed port; no test depends on the network (fonts are
  vendored; see phase 5).

## Coverage

`go test ./engine/... -cover` should report **at least 85%** for `engine`. Do not chase 100%: cover
behaviour, not lines. Coverage is a smoke alarm, not a goal.

## Race and shuffle

`go test -race -shuffle=on ./...` runs in `make test`. A test that fails only when shuffled shares state:
fix the test.

## Commands

```
go test ./...                                   # everything native
go test ./engine -run TestProp_ -rapid.checks=2000
go test ./engine -run '^$' -fuzz FuzzPlanAndSort -fuzztime=30s
go test ./engine -run Golden -update            # only for an intended behaviour change
go test ./engine -bench . -benchmem -run '^$'
GOOS=js GOARCH=wasm go test -exec="$(go env GOROOT)/lib/wasm/go_js_wasm_exec" ./engine/...
pnpm --dir web test                             # vitest
pnpm --dir web exec playwright test             # e2e
```
