# HANDOFF (self-destructing): read this first, then delete it

This file exists to start a fresh session with full context. **When the next session finishes, delete this file**
(`git rm HANDOFF.md`, commit, push) and then do the last step at the bottom ("Closing step").

## 1. The standing instructions (what Autumn originally asked, and how she wants the work done)

Original request, paraphrased faithfully:

> Look at the current project state and start an absolute rush of implementation. Don't rush too much: take your time,
> examine the code carefully, but develop as much of this project as you can without me. See how far you can get, go
> through every single step and develop it as closely to the plan as you can, and do extensive testing with Playwright and
> screenshots as you go. At the very end, tell me if anything needs my help. I know there is a lot of Cloudflare-specific
> work we cannot do yet and that is OK: hold off on it and I will handle it in a local session. This should be a
> relatively easy project and the pace has been slower than I'd like, so go through as much of it as you can.

Rules she added along the way (all still in force):

- **Git identity:** author and commit as **Autumn Brown <autumn@grove.place>** (use
  `git -c user.name="Autumn Brown" -c user.email="autumn@grove.place" commit ...`). Never other names. She wants these
  contributions under her name.
- **One branch, one pull request.** The docs say to use a branch per phase; she does not want that. Use a single branch
  and a single PR. (The branch was `build/all`, PR #1, which she merges from the GitHub UI. After it merges, start a new
  branch from `main` for follow-up work, e.g. `build/next`, and open one new PR for it. Never reuse a merged PR.)
- **Do not merge PRs yourself.** She does it in the GitHub UI.
- **Use the proper edit tools** (Read, Edit, Write), not command-line editing (`sed -i`, heredoc rewrites), for source edits.
  Quirk: the Edit tool turns a typed ` `-style escape into the raw character; build such characters with
  `String.fromCharCode` instead.
- **Keep going autonomously.** Don't stop to ask unless a decision is genuinely hers. Skip `[HUMAN]` tasks and Cloudflare/homelab
  steps; note them in `docs/dev/NOTES.md` ("Needs Autumn").
- Tick `docs/dev/PROGRESS.md` boxes in the same commit as the work. Commit messages end with the attribution lines the
  harness gives you.
- At the end of a work stretch, **tell her what needs her help**.

## 2. Where things stand

Read, in this order: `docs/dev/NOTES.md` (what is built, deviations, "Needs Autumn", the acceptance table, the 12 MP
size measurement), `docs/dev/PROGRESS.md` (the checklist), `PLAN.md`, and the per-phase files in `docs/dev/`.

Built and tested: the Go engine (native and WASM goldens), the gallery server, the SvelteKit app (Studio, Archive,
Settings, tour, runs strip, share dialog, Albums, load-from-a-link, Pro panel with regions, protect shapes you can edit on the
canvas, histogram, CA rule browser, what-can-move overlay), the Docker image, compose, the host update watcher, backups,
the Cloudflare share Worker in `worker/`, and CI (`ci.yml`: go, web, worker, worker-e2e; `docker-publish.yml`;
`deploy-worker.yml`).

## 3. Everything that is left

### 3a. Code work the agent can do (in this order)

Phase 7 remainder (`docs/dev/phase-7.md`):
- **P7-T08** the rest of the geometry modules: `svg-shapes.ts` (SVG read as data via DOMParser, never inserted in the
  page; ring counts and nesting; an XSS test that no script runs), `shape-tidy.ts` (`buildShape`, `needsTidy`, stats text),
  `region-cards.ts` (card model producing `ClassDef` JSON), and the shared fixtures that Go also reads
  (`engine/testdata/mask-spec-cases.json`, a region-card fixture). Already done: `mask-model.ts` and `snap.ts` with tests.
- **P7-T09 remainder** the UI for brush painting and the "Looks like a circle, Snap" suggestion that replaces a stroke
  with an object (the maths is in `snap.ts`); SVG shape import into the Pro panel.
- **P7-T10** region cards in the Pro panel.
- **P7-T12** the shape library (starter shapes, saved custom shapes via `/api/shapes`, snap).
- **P7-T13** phone Protect and Shapes tabs.
- **P7-T14** acceptance and phase wrap-up (fill the remaining "Partial" rows in the NOTES.md acceptance table).

Small known gaps:
- No end-to-end check of an exported file's bytes; not every state in `states.test.ts` is driven in a browser; engine failure
  dialogs are unit-tested only.
- A real (not synthetic) 12 MP photo has not been measured for run size.

Phase 9 (`docs/dev/phase-9.md`), all unstarted: P9-T01 worker pool, T02 video recording of the animation, T03 scrubbing
and rewind, T04 more segmentations, T05 mask morphology and multiple layers, T06 batch processing, T07 project
export/import and shareable recipe links, T08 TinyGo experiment, T09 detail/coarseness control, T10 polish pass.

### 3b. Things only Autumn can do (needs her, in order; this is also in `docs/dev/NOTES.md` "Needs Autumn")

1. **Merge PR #1** (she is doing this from the GitHub UI) and delete the stale remote branches `build/phase-2` to
   `build/phase-6` (the cloud proxy blocks branch deletion with a 403; everything in them is already in `build/all`).
2. **Cloudflare (P6B-T09):** create the GitHub Environment `production` and three secrets: `CLOUDFLARE_API_TOKEN`
   (Workers Scripts: Edit and Workers R2 Storage: Edit), `CLOUDFLARE_ACCOUNT_ID`, `WORKER_SHARED_SECRET` (`openssl rand -hex 32`).
   The `deploy-worker.yml` workflow then deploys on the next push to `main` that touches `worker/` (or by hand from the
   Actions tab). Decisions she still owes: Worker name/account, custom domain or `workers.dev`, default expiry.
   She can also run it locally: `cd worker && pnpm exec wrangler login`, `wrangler r2 bucket create pixelsort-share`,
   `wrangler secret put SHARED_SECRET`, `wrangler deploy`, then smoke test (`GET /a/<26 chars>` is 404, an unsigned `PUT` is 401).
3. **First deploy (P8-T11):** let CI publish the first image, make the GHCR package public, clone to `~/Pixelsort`, run
   `deploy/install.sh`, set `PIXELSORT_WORKER_URL`, `PIXELSORT_WORKER_SECRET` (same value as the GitHub secret) and the backup
   remote in `.env`, pin a first digest, `docker compose up -d`, `tailscale serve`, check `crossOriginIsolated`.
4. **P0-T09:** confirm the COOP/COEP headers survive `tailscale serve`.
5. **Meridian (P8-T11 rest):** apply `deploy/meridian/` (field names were inferred; check against a neighbouring entry), run
   the backup once, test an update from Settings, deliberately publish a broken tag to watch the rollback.
6. **P8-T12:** copy the drafted text in `docs/deploy.md` into the homelab repository, after approving it.
7. Optional: run `/lab/bench` on a phone and paste the table into `docs/perf.md`; run the arm64 image build (it was skipped in the cloud).

## 4. Environment notes that cost time before

- Go 1.27 is required: `GOTOOLCHAIN=go1.27.0`. WASM tests: `make wasm-test`. If it fails with "total length of command line
  and environment variables exceeds limit", run it under `env -i HOME=$HOME PATH=$PATH GOTOOLCHAIN=go1.27.0 make wasm-test`.
- Lint locally with golangci-lint v2.15.0 (`GOTOOLCHAIN=go1.27.0 GOBIN=/tmp/gobin go install
  github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0`, then `/tmp/gobin/golangci-lint run ./...`).
- Web: `pnpm --dir web check lint test`; e2e needs `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` re-exported on each
  call. Real-Worker e2e: `pnpm --dir web e2e:worker` (needs `pnpm --dir worker install`). Worker: `pnpm --dir worker check test`.
- CI's pnpm is 11+ with a one-day minimum release age (pin brand-new packages, e.g. `@lucide/svelte` is pinned to 1.67.0) and
  it ignores install scripts unless allowed in `pnpm-workspace.yaml` (done for `worker/`).
- SvelteKit 3: no `$lib`; use `#lib/*` and `#components/*` (package.json `imports`).
- Docker in the cloud container: start `dockerd` by hand, use `mirror.gcr.io` and the CA secret (see NOTES.md).
- Every playwright test starts as someone who has had the tour (storageState in `playwright.config.ts`).
- Avoid listing all workflow runs through the GitHub tool (huge output); read check runs for the PR instead.

## 5. Closing step (do this last, when the work in this file is done or the session is ending)

1. Delete this file: `git rm HANDOFF.md`, commit as Autumn Brown, push.
2. **Write the second handoff** for her desktop session, where she has Wrangler, Docker and her homelab and can run
   everything the cloud could not. Call it `DESKTOP-HANDOFF.md` (also self-destructing: it says to delete itself when done).
   Build it from `docs/dev/NOTES.md` "Needs Autumn" (section 3b above): for each step give the exact commands, what to
   verify, and what to record afterwards (update `docs/dev/NOTES.md` and tick `PROGRESS.md`: P0-T09, P6B-T09, P8-T11, P8-T12).
   Add a short "run everything locally" checklist: `make check test wasm-test`, `make image-test`, `make deploy-test`,
   `pnpm --dir web check lint test`, `make e2e`, `make e2e-worker`, `pnpm --dir worker check test`.
3. Tell her what is left and what needs her.
