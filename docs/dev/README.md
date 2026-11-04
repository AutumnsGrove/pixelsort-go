# Development plans

How pixelsort-go gets built. These files are written so a fast, cheap coding agent can work through them
task by task without needing the whole project in its head, and so a person (or a careful reviewer) can
check the work afterwards.

**Product and design decisions live in [`../../PLAN.md`](../../PLAN.md).** These files say *how to build it*.
The visual and behavioural spec is the working mockup in [`../../mockups/`](../../mockups/): open
`mockups/index.html`, and treat `mockups/tests/` as the acceptance tests for the real app.

## Read in this order

1. [`AGENT.md`](AGENT.md): the rules of the game. The loop for every task, commit style, what to do when
   stuck. **Read this first, every session.**
2. [`conventions.md`](conventions.md): Go and TypeScript standards, project layout, the determinism rules.
3. [`testing.md`](testing.md): TDD, property tests, fuzzing, goldens, benchmarks, and the exact commands.
4. [`decisions.md`](decisions.md): choices made while writing these plans (they refine PLAN.md; where they
   differ, **these win**).
5. [`PROGRESS.md`](PROGRESS.md): the checklist of every task. Tick a box in the same commit as the work.
6. The phase file you are on, then only the task you are on.

## Phases

| Phase | File | What it delivers | Depends on |
|---|---|---|---|
| 0 | [`phase-0.md`](phase-0.md) | Repo scaffold, Makefile, lint, CI, hello-world WASM in a worker | none |
| 1 | [`phase-1.md`](phase-1.md) | The engine, native Go: lines, keys, intervals, regions plumbing, instant sort | 0 |
| 2 | [`phase-2.md`](phase-2.md) | Engine as WASM, worker, bare page, perf measurements | 1 |
| 3 | [`phase-3.md`](phase-3.md) | The stepper: watch the sort happen | 1, 2 |
| 4 | [`phase-4.md`](phase-4.md) | Cellular-automaton intervals | 1 |
| 5 | [`phase-5.md`](phase-5.md) | The real SvelteKit UI (Studio, phone, Settings, Archive shell) | 2, 3, 4 |
| 6 | [`phase-6.md`](phase-6.md) | Gallery server: SQLite, storage, API, trash, usage | 0 |
| 6b | [`phase-6b.md`](phase-6b.md) | Cloudflare Worker: share links and URL loading | 6 |
| 7 | [`phase-7.md`](phase-7.md) | Regions: tessellations, masks, custom shapes (engine + UI) | 1, 5 |
| 8 | [`phase-8.md`](phase-8.md) | Docker, CI image publish, in-app updates, Meridian, backups | 6, 6b |
| 9 | [`phase-9.md`](phase-9.md) | Polish and stretch | all |

Phases 1 and 6 do not depend on each other, so they can be built in either order. Phase 4 can run any time
after phase 1. Everything else follows the table.

## Where things go

```
docs/dev/                  these plans (PROGRESS.md and NOTES.md are the only files an agent edits here)
docs/dev/reference/        verified reference code for the riskiest primitives (.go.txt, not compiled)
engine/  cmd/  server/  worker/  web/  deploy/    the code, as laid out in conventions.md
mockups/                   the throwaway design mockups; never modify, only read
```

## Who does what

- **The build agent** works one task at a time on a `build/phase-N` branch, commits each task, and never
  pushes (see `AGENT.md`).
- **Autumn** does the steps marked **[HUMAN]** (anything that touches Cloudflare, the homelab, her accounts or
  her money) and merges phases after review.
- **Review** happens after each phase: diff `main...build/phase-N`, read `NOTES.md`, run `make check` and
  the phase's acceptance command, then merge.
