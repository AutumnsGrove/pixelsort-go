# AGENTS.md

How to work on pixelsort-go. Written for a coding agent on Autumn's machine; a person will find it useful too.

Run every command from the repo root. Commit as **Autumn Brown <autumn@grove.place>**.

## What this is

A pixel sorter you can watch. The engine is pure Go, compiled to WebAssembly and run in the browser; a SvelteKit
front end drives it and a small Go server keeps the gallery. The server never touches pixels.

| Path | What it holds |
|---|---|
| `engine/` | The sorter. Standard library only, no I/O, no globals, no `syscall/js`. Read `engine/README.md`. |
| `cmd/` | The `pixelsort-go` CLI (`serve`, `render`, `version`) and the `js/wasm` bindings. |
| `server/` | Gallery API: SQLite, storage, trash, share relay, embedded web assets. |
| `web/` | SvelteKit app (TypeScript). `worker/` is its Cloudflare Worker for share links. |
| `deploy/` | Dockerfile, compose, watcher scripts. |
| `mockups/` | The visual spec. Read-only — never edit it, and `mockups/tests/` are acceptance tests. |
| `docs/` | `dev/` plans and conventions, plus API, deploy, gallery and perf notes. `PLAN.md` is the product plan. |

## Commands

`make check` before every commit. It runs gofmt, `go vet`, `golangci-lint` and the fast tests.

| Command | What it does |
|---|---|
| `make check` | format, vet, lint, short tests |
| `make test` | every Go test, with `-race` |
| `make fuzz` | every fuzz target for `FUZZTIME` (default 20s) |
| `make wasm` / `make wasm-test` | the engine as WebAssembly, and its tests under Node |
| `make embed-build` | build the WASM and embed the web app into the server binary |
| `make web` / `make web-test` / `make e2e` | the SvelteKit app, its unit tests, its browser tests |
| `make image` / `make image-test` / `make compose-test` | the container, and checks of it |
| `make bench` | engine benchmarks |

Web work also has `pnpm --dir web check lint test`; `pnpm --dir web format` is prettier. Go is 1.27, Node 26,
pnpm 10, `golangci-lint` v2.

## Rules that matter

- **Tests are the specification.** Write the failing test first, then the least code that makes it pass. No
  skipped or commented-out tests, no `TODO` without an issue number.
- **Determinism is not optional.** No `math/rand`, no clock, no goroutine scheduling, no map iteration order,
  and nothing that decides *where a pixel goes* uses floats. `engine/README.md` lists the exact rules; read them
  before touching the engine.
- **Goldens are behaviour.** `engine/testdata/golden/*.sha256` pin fourteen recipes. A changed hash means you
  changed behaviour: bump `EngineVersion` in the same commit and say why, or find the bug.
- **`engine/` imports the standard library only** (plus `rapid` in tests).
- Errors are returned and wrapped with `%w`. Exported things get doc comments starting with their name. Comments
  explain *why*.
- Split a file at about 400 lines. Prefer the standard library; a new dependency needs a reason in the PR.

## Working

Branch from `main`, one branch per piece of work, one pull request. Autumn merges in the GitHub UI.

Commits are present tense and imperative ("Add line partition"), first line under 50 characters, no full stop.
Small follow-ups get their own commit ("Fix the caption row height").

Open work lives in GitHub issues. When you make a judgement call the spec did not settle, write it at the top of
`docs/dev/NOTES.md` under a dated heading: what you chose, why, and what you rejected. That file is how the next
session catches up — read its newest entries before starting.

Anything that needs Autumn's accounts, her money or her homelab is hers: leave it, and note it under "Needs
Autumn" in `docs/dev/NOTES.md`.

## Reading list

Start with `docs/dev/conventions.md` (layout, Go and TypeScript standards, determinism), then
`docs/dev/testing.md` (TDD, property tests, goldens, the exact commands) and `docs/dev/decisions.md` (choices that
override `PLAN.md` where they differ). Read `PLAN.md` in sections as needed, not end to end.
