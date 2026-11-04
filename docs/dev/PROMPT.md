# Prompts

Ready-to-paste instructions for the build agent (for example DeepSeek in the pi harness) and for the reviewer.

## Start or continue building

```
You are building pixelsort-go in this repository. Everything you need is in docs/dev/.

1. Read docs/dev/AGENT.md first and follow it exactly. Then read docs/dev/conventions.md,
   docs/dev/testing.md and docs/dev/decisions.md.
2. Open docs/dev/PROGRESS.md and find the first unticked task. Work on a branch named
   build/phase-N (create it from main if it does not exist). Read only that task in its phase file.
3. Do the task test-first, exactly as AGENT.md describes: write the tests, watch them fail, make them pass,
   run `make check`, tick the box, commit with the message the task gives. One task per commit.
4. Then take the next unticked task. Keep going until the phase is finished, then stop.
5. Never push, never touch main, never touch anything outside this repository, and skip tasks marked
   [HUMAN] (note them in docs/dev/NOTES.md under "Needs Autumn").
6. If the spec is unclear, choose the simplest option consistent with the spec and log it in
   docs/dev/NOTES.md. Do not stop to ask.

Begin now.
```

## Start a specific phase

Use the same prompt and add as the first line: `Work on phase 3 only (docs/dev/phase-3.md); stop when it is finished.`

## Resume after an interruption

```
Continue building pixelsort-go. Read docs/dev/AGENT.md, then docs/dev/PROGRESS.md and `git log --oneline -10`.
Run `git status`; if anything is uncommitted, finish that task first (tests, make check, tick, commit).
Then continue with the first unticked task.
```

## Ask for a review (give this to Claude)

```
Review the build/phase-N branch of pixelsort-go against docs/dev/phase-N.md and docs/dev/decisions.md.
Diff against main, read docs/dev/NOTES.md first, run make check and the phase's acceptance commands,
and report: tests that do not test what their task asked, behaviour that differs from the spec or the
mockups, determinism hazards (floats, maps, goroutines), skipped or weakened tests, and anything in NOTES.md
that needs a decision from Autumn.
```
