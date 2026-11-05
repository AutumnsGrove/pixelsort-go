# DESKTOP-HANDOFF (self-destructing): for your desktop session; read this first, then delete it

This is for a session on **your own machine**, where you have Wrangler, Docker, Tailscale and the homelab, and can run what the
cloud sandbox could not. **When every step below is done (or you decide to stop), delete this file** (`git rm DESKTOP-HANDOFF.md`,
commit, push).

Rules that still hold (from the first handoff):

- **Git identity:** commit as **Autumn Brown <autumn@grove.place>**
  (`git -c user.name="Autumn Brown" -c user.email="autumn@grove.place" commit ...`).
- One branch, one pull request. `build/next` was the working branch for this stretch; once it is merged, start a new branch from `main`.
  You merge PRs yourself in the GitHub UI.
- Use the proper edit tools, not `sed -i` or heredoc rewrites, for source edits.
- Tick `docs/dev/PROGRESS.md` boxes in the same commit as the work, and write what happened in `docs/dev/NOTES.md`.

## 0. Where things stand

Phases 0 to 8 are built and tested in the cloud, phase 7 is finished (regions, region cards, shape library with SVG import and the tidy
panel, brush painting with snap-to-shape, phone bottom sheet), and from phase 9 only **P9-T03 (scrubbing)** is done. Everything left in this file is
a step that needs your accounts or your homelab. Nothing here was run for real yet. Read `docs/dev/NOTES.md` ("Needs Autumn", the
acceptance table) and `docs/deploy.md` (the page to follow) first.

## 1. Run everything locally first (about ten minutes)

If any of these fail on your machine but passed in the cloud, that is worth knowing before you deploy: note it in `NOTES.md`.

```bash
export GOTOOLCHAIN=go1.27.0               # Go 1.27 is required
make check test wasm-test                 # gofmt, vet, golangci-lint, short tests, race tests, the engine under WebAssembly
make image-test                           # builds the container and runs it for real (needs Docker)
make deploy-test                          # the shell tests under deploy/ (fakes only, no Docker, no network)
pnpm --dir web install && pnpm --dir web check lint test
make e2e                                  # Playwright, 78 tests (needs a Chromium; set PLAYWRIGHT_CHROMIUM_PATH to use one you have)
pnpm --dir worker install && pnpm --dir worker check test
make e2e-worker                           # the real Worker (wrangler dev) driven by the real Go server
```

Notes: if `make wasm-test` fails with "total length of command line and environment variables exceeds limit", run it under
`env -i HOME=$HOME PATH=$PATH GOTOOLCHAIN=go1.27.0 make wasm-test`. The arm64 image build was skipped in the cloud (the
`PIXELSORT_SKIP_ARM64` variable skips it in `deploy/image-test.sh`); on your machine leave that variable unset so `make image-test` builds
arm64 too (QEMU emulation is fine; it is slow), and record the result.

**Record:** one line in `NOTES.md` with the date and anything that behaved differently.

## 2. Merge the pull request and clean up branches

1. Open the pull request for `build/next` (or the one the cloud session opened) and merge it from the GitHub UI. (The earlier PR #1 is already merged.)
2. Delete the stale remote branches: `build/phase-2` to `build/phase-6`, and `build/all` and `build/next` after merging (the cloud proxy blocked branch
   deletion with a 403; everything in them is already in `main`):
   ```bash
   git push origin --delete build/phase-2 build/phase-3 build/phase-4 build/phase-5 build/phase-6
   ```

## 3. Cloudflare (P6B-T09): the share Worker

Decisions you still owe, and that this step settles: the Worker name and account, `workers.dev` or a custom domain, the default expiry (see
`worker/wrangler.jsonc`, `worker/src`, and `docs/dev/phase-6b.md`).

**Option A, from GitHub (what the workflow is built for):**

1. Repository **Settings, Environments:** create `production` (add yourself as a required reviewer if you want a click before each deploy).
2. Cloudflare **My Profile, API Tokens:** create a token with *Workers Scripts: Edit* and *Workers R2 Storage: Edit* for your account.
3. Add three secrets on the environment: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (on the Workers overview page) and
   `WORKER_SHARED_SECRET` (`openssl rand -hex 32`).
4. Run `deploy-worker.yml` by hand from the Actions tab (or push a change under `worker/` to `main`). It creates the `pixelsort-share` R2 bucket if it is
   missing, sets `SHARED_SECRET`, deploys, and smoke-tests the live URL.

**Option B, from your machine:**

```bash
cd worker && pnpm install
pnpm exec wrangler login
pnpm exec wrangler r2 bucket create pixelsort-share
pnpm exec wrangler secret put SHARED_SECRET        # paste the same value you will put in the server's .env
pnpm exec wrangler deploy                          # prints the Worker's URL
```

**Verify (either way):**

```bash
URL=https://<the printed url>
curl -s -o /dev/null -w '%{http_code}\n' "$URL/a/AAAAAAAAAAAAAAAAAAAAAAAAAA"   # 26 characters: expect 404
curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$URL/api/albums/AAAAAAAAAAAAAAAAAAAAAAAAAA/images/0"   # unsigned PUT: expect 401
```

**Record:** the URL (and the account and expiry decisions) in `NOTES.md`; tick `P6B-T09` in `PROGRESS.md`.

## 4. First deploy (P8-T11) and the front door (P0-T09)

Follow `docs/deploy.md`, "First deploy". In short:

1. Push to `main`, let `docker-publish.yml` publish the first image, then make the GHCR package **public** and linked to the repo.
2. On the homelab host:
   ```bash
   git clone https://github.com/AutumnsGrove/pixelsort-go ~/Pixelsort
   cd ~/Pixelsort && deploy/install.sh
   ```
3. Edit `~/Pixelsort/.env`: `PIXELSORT_WORKER_URL` (from step 3), `PIXELSORT_WORKER_SECRET` (**the same value** as `WORKER_SHARED_SECRET`),
   `PIXELSORT_BACKUP_REMOTE` (an rclone remote path).
4. Pin a first digest and start it:
   ```bash
   docker buildx imagetools inspect ghcr.io/autumnsgrove/pixelsort:latest | sed -n 's/^Digest: *//p'
   # put it in .env as PIXELSORT_IMAGE_DIGEST=sha256:...
   docker compose up -d
   curl -s localhost:8895/healthz            # {"status":"ok","version":"r..."}
   docker compose ps                         # healthy
   ```
5. Front it with Tailscale and check the isolation headers (this is **P0-T09**):
   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:8895
   curl -sI https://<machine>.<tailnet>.ts.net/engine.wasm | grep -i 'content-type\|cross-origin'
   ```
   Open the HTTPS address and run `crossOriginIsolated` in the browser console: it must be `true`. All three `Cross-Origin-*` headers must be present.
   If one is missing, the proxy is stripping it: note which in `NOTES.md` (the app still works; version 1 does not need `SharedArrayBuffer`, decision B3).
6. Smoke test as a person: open Studio, load a photo, sort it, animate it, drag the new scrub slider, cut it into hexagons, paint a protected area, save to the
   Archive, make a share link and open it in another browser.

**Record:** `NOTES.md` (what you saw, the digest you pinned); tick `P0-T09` and `P8-T11` (the first part) in `PROGRESS.md`.

## 5. Meridian, backup, update and rollback (P8-T11, the rest)

1. Apply `deploy/meridian/` by hand. The field names were **inferred** from `docs/update.md`: compare each snippet with a neighbouring entry
   (Warbler, Polaris, Ivy) before pasting. `deploy/meridian/test.sh` only checks that each snippet parses.
2. Run the backup once and look at the remote:
   ```bash
   systemctl start pixelsort-backup.service && journalctl -u pixelsort-backup.service -n 5
   ```
3. Test an update: Settings, Updates, *Check*, then *Update now* (or `systemctl start pixelsort-update.service`).
4. Watch a rollback work once: publish a deliberately broken image under another tag (say `broken-test`), set `PIXELSORT_UPDATE_TAG=broken-test` in `.env`,
   press *Update now*, expect Settings to say the update did not work and the previous version is back, then set the tag back to `latest`.

**Record:** `NOTES.md`; tick the rest of `P8-T11`.

## 6. Homelab documentation (P8-T12)

`docs/deploy.md`, "Drafted text for the homelab repository", has the text for `docs/pixelsort.md` and the port-map row. Read it, change what you want,
and copy it into the homelab repository yourself (nobody edits that repo for you). **Record:** tick `P8-T12`.

## 7. Optional

- Run `/lab/bench` on a phone and paste the table into `docs/perf.md` (the numbers there are from the cloud sandbox and a desktop-class Chromium).
- A real 12 MP photo has not been measured for exported file size: export one as PNG and JPEG and record the sizes under the "12 MP size measurement"
  in `docs/dev/NOTES.md`, section "Size of a 12 MP run (P6-T15)" (the table there is from a synthetic image).
- Phase 9 is yours to pick: `docs/dev/phase-9.md` has T01 (worker pool), T02 (video recording), T04 (more segmentations), T05 (mask morphology and layers),
  T06 (batch processing), T07 (project export/import and recipe links), T08 (TinyGo experiment), T09 (detail control), T10 (polish). T03 is done.

## 8. When you are finished

1. Make sure `PROGRESS.md` has `P0-T09`, `P6B-T09`, `P8-T11` and `P8-T12` ticked and `NOTES.md` "Needs Autumn" is emptied of what is done.
2. `git rm DESKTOP-HANDOFF.md`, commit as Autumn Brown, push.
