# Agent protocol

You are building pixelsort-go, a pixel sorter whose engine is written in Go and runs in the browser as
WebAssembly. These are the rules. They are short on purpose. Follow them exactly.

## Your setup

- Repo root is where `go.mod` lives. Run every command from the repo root unless a task says otherwise.
- Tools available on this machine: Go 1.27, Node 26, pnpm 10, `golangci-lint`, `staticcheck`, `wrangler`,
  Docker. If a command is missing, say so in `NOTES.md` and carry on with whatever does not need it.
- You work on a branch named `build/phase-N` (create it from `main` when you start phase N). You commit to
  that branch. **You never push, never merge, never touch `main`.**
- You only edit files inside this repo. You never touch the homelab, Cloudflare, anyone's accounts, or any
  secret. Tasks that need those are marked **[HUMAN]**: skip them, write one line in `NOTES.md` under
  "Needs Autumn", and carry on with tasks that do not depend on them.

## What to read

Every session: this file, `conventions.md`, `testing.md`, `decisions.md`, then `PROGRESS.md` to find the
first unticked task, then **only** that task in its phase file. Do not read `PLAN.md` end to end. Read the
sections a task points at. The mockups in `mockups/` are the behavioural spec for the UI; read the file a
task names, not the whole folder.

## The loop (one task = one commit)

For each task, in order, never skipping ahead:

1. **Read the task.** Each one lists Files, Spec, Tests to write first, Verify, and Commit.
2. **Write the tests first.** Create the test files named in the task. Run them. They must **fail**, and
   fail for the right reason (a missing function or a wrong answer, not a typo). Look at the output.
3. **Write the least code that makes them pass.** Follow the Spec exactly. Where the task includes
   reference code, start from it.
4. **Run the task's Verify commands.** Every one must pass.
5. **Run `make check`.** It runs format check, vet, lint and the fast tests. It must pass.
6. **Tick the task** in `PROGRESS.md` (change `[ ]` to `[x]`) in the same commit.
7. **Commit** with the message in the task. Then start the next task.

A task is done only when steps 2 to 6 all happened. If a task's tests were already passing before you wrote
any code, the tests are not testing anything: make them fail first, or explain in `NOTES.md` why not.

## Commit style

- Present tense, imperative: "Add line partition", not "Added" or "Adds".
- First line under 50 characters. No full stop.
- Body (optional) says *why* when it is not obvious. Last line of the body: `Task: P1-T05`.
- One task per commit. Small fixes to an earlier task go in their own commit: `Fix <thing> (P1-T05)`.
- Never commit generated build output (`web/build`, `*.wasm`, coverage files) or anything in `.gitignore`.

## When the spec is unclear or you disagree with it

Do not stop and do not wait. Make the simplest choice that is consistent with the spec and with
`PLAN.md`, do the work, and add an entry to `docs/dev/NOTES.md`:

```
## <date> · P1-T05 · <one-line question>
Chose: <what you did>. Because: <why>. Alternative: <the other option>.
```

If a test you wrote turns out to be wrong, fix the test and say so in the commit body. If the spec itself
looks wrong (for example it contradicts another part of the plan, or a number is far off), do the nearest
sensible thing and record it in `NOTES.md` so the reviewer sees it. Never silently change behaviour that the
mockups or `decisions.md` define.

## Quality bar (a reviewer will check these)

- Tests are the specification. No task is finished with a skipped, commented-out or deleted test.
- No `TODO` without a task ID (`TODO(P4-T02):`). No dead code. No commented-out code.
- Exported things have doc comments that start with their name. Comments explain *why*, not *what*.
- Errors are returned and wrapped with `%w`, never swallowed. No `panic` in library code except for
  programmer errors that tests would catch (and say so in the comment).
- Determinism rules in `conventions.md` are not optional: no `math/rand`, no map iteration order leaking
  into output, no wall-clock time or goroutine scheduling affecting results.
- Keep functions short and files focused. If a file passes about 400 lines, split it.
- Prefer the standard library. The intended dependencies are listed in `conventions.md`. If you need
  another, you may add it: keep it small and well known, and say why in `NOTES.md`.

## Useful commands

```
make check        # format check + vet + lint + unit tests (run before every commit)
make test         # all Go tests, with -race
make fuzz         # a short run of every fuzz target
make wasm         # build the engine to WebAssembly
make web          # install and build the web app
make e2e          # browser tests
make bench        # benchmarks
```

(Phase 0 creates these. Until it has, run the plain `go` commands in the task.)

## Ending a session

Leave the tree clean: everything committed, `PROGRESS.md` accurate. Add anything a reviewer or the next
session should know to the top of `NOTES.md` under a dated heading. Do not leave half-finished work
uncommitted. If you must stop mid-task, commit whatever passes and describe the rest in `NOTES.md`.
