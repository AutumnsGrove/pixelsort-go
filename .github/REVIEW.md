# Notes for the reviewer

Guidance for the automated reviewer (`claude-review`). Read the repository's own instructions first
(`AGENTS.md`, then `docs/dev/conventions.md` and `docs/dev/testing.md`); this file says only where a
review's turns are worth spending.

This file is taken from the **base branch** before the review starts, so it cannot be rewritten by the
pull request being reviewed. A `git worktree` you create at `HEAD` brings the pull request's own copy
back: restore this file inside the copy before you read it there.

## What this job can run

The job checks out `refs/pull/<n>/merge` — base merged into the head, not the head alone — and installs
both toolchains before the reviewer starts:

- Go, from `go.mod`, plus `golangci-lint` v2. `go test`, `make check`, `make test`, `make fuzz`,
  `make wasm-test`, `make bench` and the CLI all work.
- Node 22 with Corepack, and `pnpm install` has run under `web/` and `worker/`. `pnpm --dir web check`,
  `lint`, `test` and `pnpm --dir worker check`, `test` work.

Not installed, and never a finding:

- **Playwright browsers.** `make e2e` and `worker-e2e` need `pnpm --dir web exec playwright install
  --with-deps chromium`, which this job skips because it costs more than the review. A missing-browser
  error is the environment.
- **Docker.** `make image`, `make image-test` and `make compose-test` cannot run here.

Check `CLAUDE_REVIEW_DEPS` before claiming you ran something: `installed` means both toolchains are
ready, `unavailable` means an install failed and anything that needs the network may fail too. Say which
one it was in the review.

## Spend them on running the thing

CI reports as `go`, `web`, `worker` and `worker-e2e`, and `ci.yml` runs `make test` with `-race`,
`make fuzz`, the WASM tests and the browser end-to-end suite — more than `make check` covers. Read the
runs with `gh run list` and `gh run view <id> --log-failed` rather than repeating what they already did.

1. **Reproduce the bug the pull request says it fixed.** Work in `git worktree add /tmp/pixelsort-go-probe
   HEAD`; it carries `.git` and the history, so reverting the fix inside it works. `git archive` is the
   wrong tool: it carries no history and no ignored files, and its `tar -x -C` fails unless the directory
   exists. If the change touches a package that embeds a built frontend, build that in the copy first, or
   the revert comparison proves nothing.
2. **Run what the pull request claims to have run**, and compare its output with the figures in the body.
   A body that does not match the tree is a finding; a body that matches it is a reason to trust the rest.
   Keep it to the target and the package: the reviewer step is capped at 25 minutes, and a review killed
   before it posts is worth nothing.
3. **Derive the arithmetic** in any comment that asserts a count, a byte length, a boundary, a budget or a
   timeout. It is a claim you can check by computing it, and an off-by-a-few at an edge is the bug that
   survives both a compiler and a test suite written by the person who wrote the bug.
4. **For every new test, delete the changed lines.** Does it still pass? If it does, the test is not
   testing the change, whatever its title says.
5. **For anything that decides pass or fail, read the exit code and the report shape it reads.** A script
   that reports success on a failed run is the highest-severity finding in a repository whose gate is the
   definition of done.

## Do not spend them on

Style, formatting and naming: the formatter owns those and `make check` owns the rest. And a finding you
cannot point at with `path:line`, or that no rule in this repository settles, is not a finding.

A workflow change is the exception worth a mechanical run: `actionlint` parses `.github/workflows/` and
catches expression and context mistakes that YAML alone does not. It is not installed, so
`go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/<file>.yml` costs one download
and is the closest thing this repository has to a test for a workflow.

Two other things are out of bounds rather than merely low-value: **do not change the checkout**, and
**do not push, approve, request changes or merge**. Scratch work goes in `/tmp`. The reviewer's job ends
at the comment.

## Reporting

Post inline comments on the lines that changed, at most 25 of them, and finish with one short summary
comment. Report only what you ran, with the command and its output. If you could not reproduce something,
say so in one line, or drop it. Two demonstrated findings beat ten plausible ones, and "nothing
significant found" is a good review when it is true.
