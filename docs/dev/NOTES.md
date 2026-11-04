# Build notes

The build agent writes here; the reviewer reads here first. Newest entries at the top of each section.

## Needs Autumn

Steps only a person can do (Cloudflare, the homelab, accounts). Each line: the task id, what, and why it is waiting.

- **P0-T09** · Confirm COOP/COEP survive `tailscale serve` (steps in [`phase-0.md`](phase-0.md), P0-T09). Waiting
  on Autumn because it touches the homelab and her tailnet. Everything up to the front door is verified: `make
  spike` serves `Content-Type: application/wasm` plus all three `Cross-Origin-*` headers, and a headless
  Chromium run of `http://127.0.0.1:8895/` showed `crossOriginIsolated true`, `SharedArrayBuffer available`
  and `engine version 1`. What is unproven is only whether the HTTPS proxy passes the headers through.

## Decisions and questions

One entry per choice the agent made when the spec was unclear (format in `AGENT.md`).

## 2026-11-04 · P1-T09 · Wave intervals do not average to `length`

Chose: the wave formula of decision E7 exactly, and a test that pins its *range* (about 8..56 px at `length` 30)
rather than its mean. Because: the width is a function of the position along the line, so short segments get
sampled more often than long ones and the average interval is the harmonic mean (about 21 px for `length` 30), not
the arithmetic one. `random`, which draws each width independently, is the mode whose mean equals `length` — that is
the promise PLAN.md 3.3 makes about the slider. Alternative: accumulate widths and correct, which would be a
behaviour change to a spec the mockups already show.

## 2026-11-04 · P1-T01 · Branch base for phase 1

Chose: `build/phase-1` created from `build/phase-0`, not from `main`. Because: `AGENT.md` assumes the previous
phase has been merged when the next starts, and phase 0 is still waiting for review (`P0-T09` is Autumn's). Branching
from `main` would have meant a tree with no `go.mod`. Alternative: wait for the merge, or cherry-pick phase 0 into
the new branch.

## 2026-11-04 · P0-T01 · How much of the old `.gitignore` survives?

Chose: the list from the task, plus the entries the repo already relied on (`.DS_Store`, `.env.*` with
`!.env.example`, `*.test`, `*.out`, `/bin/`), and dropped the narrower `web/static/*.wasm` because `*.wasm`
already covers it. Because: the task's list is what phase 0 needs; deleting the rest would have made the repo
start committing macOS droppings and local env files. Alternative: replace the file with the literal task list.

## 2026-11-04 · P0-T01 · `go.mod` version line

Chose: `go 1.27`, as the task says, rather than the `go 1.27.3` that `go mod init` writes. Because: the CI job
reads `go-version-file: go.mod` and should get the newest patch of 1.27, not be pinned to this machine's.
Alternative: keep the full `1.27.3`.

## 2026-11-04 · P0-T01 · `.editorconfig` beyond the letter of the spec

Chose: also set `trim_trailing_whitespace = true` (off for `*.md`, where two trailing spaces mean a line
break). Because: the spec names charset, line endings, final newline and indentation; trimming is the same
kind of hygiene and prevents noisy diffs. Alternative: only the four named settings.

## 2026-11-04 · P0-T07 · How was the spike checked without a browser on screen?

Chose: the mockups' Playwright Chromium (`mockups/tests/node_modules`) driving the real page over
`http://127.0.0.1:8895/`, with the throwaway script kept outside the repo in `/tmp`. Because: the task asks
for a person to look at the page, and a headless load answers the same question (isolated, `ping()` returns
`1`) without adding a dependency before phase 5 needs one. Alternative: leave the page unverified until
P0-T09.
