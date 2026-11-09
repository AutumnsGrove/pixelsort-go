# Deploying pixelsort-go

The one page to follow. Everything here is a command you run yourself: nothing in this repository touches the homelab, Tailscale, GHCR visibility,
Meridian or any account. Steps that do are marked **you**.

## What you get

A single Docker container (about 31 MB, distroless, read-only, no capabilities, running as your deploy user) serving the app and the gallery API on
`127.0.0.1:8895`, fronted by `tailscale serve`. It is pinned to an image **digest**, updates itself from Settings through a host-side watcher
(snapshot, pull, health check, rollback), and backs its database up nightly.

## Prerequisites

- A Linux host with Docker and the compose plugin, systemd, `flock`, `curl`, and `rclone` (for backups).
- The repository's CI has published an image to `ghcr.io/autumnsgrove/pixelsort` at least once, and the package is public (or the host is logged in).
- Port 8895 free on the host (`ss -ltn | grep 8895`).

## First deploy

1. **you** — Push to `main`. CI (`ci.yml`) runs, then `docker-publish.yml` builds `linux/amd64` and `linux/arm64` and pushes `latest` and the short sha.
   After the first publish, make the GHCR package public and link it to the repo (the image's `source` label does the linking).
2. **you** — Clone to `~/Pixelsort` on the host and run the installer:
   ```bash
   git clone https://github.com/AutumnsGrove/pixelsort-go ~/Pixelsort
   cd ~/Pixelsort && deploy/install.sh
   ```
   It creates `data/` and `update-signal/`, writes `.env` **only if there is none** (and your uid and gid into it), installs the systemd units for the
   watcher and the backup, and enables the path unit and the timers. It never overwrites `.env`. Run it again after any `git pull`.
3. **you** — Edit `.env`: set `PIXELSORT_WORKER_URL` and `PIXELSORT_WORKER_SECRET` once the Worker is deployed (phase 6b), and `PIXELSORT_BACKUP_REMOTE`.
4. **you** — Pin a first digest. Take it from the publish run's summary or:
   ```bash
   docker buildx imagetools inspect ghcr.io/autumnsgrove/pixelsort:latest | sed -n 's/^Digest: *//p'
   ```
   Put it in `.env` as `PIXELSORT_IMAGE_DIGEST=sha256:...`, then `docker compose up -d`.
5. Check it: `curl -s localhost:8895/healthz` prints `{"status":"ok","version":"r…"}` and `docker compose ps` shows `healthy`.
6. **you** — Front it with Tailscale: `tailscale serve --bg --https=443 http://127.0.0.1:8895` (adjust to your tailnet). Open the HTTPS address and, in the
   browser console, check `crossOriginIsolated` is `true`. If it is `false` the proxy is stripping the `Cross-Origin-*` headers: see PLAN.md phase 0 (P0-T09).

## Cloudflare (the share Worker)

`.github/workflows/deploy-worker.yml` tests and deploys `worker/` whenever it changes on `main`, or when you run it by hand from the Actions tab.
It also creates the `pixelsort-share` R2 bucket if it is missing, sets the Worker's `SHARED_SECRET`, and smoke-tests the live URL
(`GET /a/<id>` must be `404`, an unsigned `PUT /api/albums/<id>/images/0` must be `401`). Once, in the GitHub repository settings:

1. **Settings, Environments:** create one named `production`. Add yourself as a required reviewer if you want a click before each deploy.
2. **Cloudflare, My Profile, API Tokens:** create a token with *Workers Scripts: Edit* and *Workers R2 Storage: Edit* for your account.
3. **Secrets** (on the environment, or on the repository): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (shown on the Workers overview page),
   and `WORKER_SHARED_SECRET` (make one with `openssl rand -hex 32`).
4. Put the **same** secret in the server's `.env` as `PIXELSORT_WORKER_SECRET`, and the Worker's URL (printed by the deploy run) as `PIXELSORT_WORKER_URL`.

To rotate the secret: change `WORKER_SHARED_SECRET`, run the workflow by hand, then update `.env` and restart. 

## Shape helper (optional)

"Ask for a shape" asks a vision model to pick things out of the picture. It is off unless the server has an OpenRouter key;
with no key the route does not exist, `GET /api/features` says `"helper": false`, and Settings says so. *Cut out this object*
needs none of this and always works.

1. **you** — On [openrouter.ai](https://openrouter.ai/keys) create a key and put a few dollars of credit on the account (a request is
   a 512 px copy of the picture and a sentence, so it costs a fraction of a cent; a key with no credit answers `402`).
2. **you** — Add it to `.env` next to `docker-compose.yml`, as `PIXELSORT_OPENROUTER_KEY=sk-or-…`. No spaces or line breaks
   around it: the server refuses to start and says which variable is at fault rather than running with a mangled key.
3. Restart the container so it reads the new environment: `docker compose up -d` (add `--force-recreate` if `docker compose ps`
   shows the old start time). Nothing else changes: the key is read at start and never leaves the process.
4. Check it: `curl -s localhost:8895/api/features | grep -o '"helper":[a-z]*'` prints `"helper":true`, and Settings → Shape helper
   says it is on. The first request on each device shows the notice about what is sent.

`PIXELSORT_HELPER_MODEL` overrides the model (`vendor/name`, and it must accept pictures). The default is
`deepseek/deepseek-v4.1-flash-1017`, which reads images. A model that does not take pictures is refused with a sentence
naming it rather than a failed request; so is a model the provider does not list. Two requests run at once and twelve a
minute, so a runaway tab cannot spend the account.

The key is the same one for every device on this server: there is no per-device or per-person key, and no way to turn the
helper on for one browser only.

## What updates, and what does not

| | How it updates |
|---|---|
| The image (app, engine, WASM) | **Automatically**: Settings → Updates → *Check*, then *Update now*; or Meridian's tap; or `systemctl start pixelsort-update.service` |
| The checkout (compose file, watcher script, units, installer) | **By hand**: `git pull && deploy/install.sh` |

An update resolves the newest digest itself from GHCR (the app never names an image), waits up to 60 s for an upload to finish, snapshots the database to
`data/backups/pre-update.db`, pins the new digest in `.env`, pulls, recreates, and waits up to 120 s for health. If the new version is not healthy it restores
the snapshot, pins the old digest and recreates: Settings then says the update did not work and the previous version is back. The full design is
[`update.md`](update.md); the watcher's behaviour is pinned by `deploy/watcher/test.sh`.

To watch a rollback work once, publish a deliberately broken image under another tag (for example `broken-test`), set `PIXELSORT_UPDATE_TAG=broken-test`
in `.env`, press *Update now*, then set it back to `latest`.

## Backups

`pixelsort-backup.timer` runs `deploy/backup/backup.sh` at 03:40 every day. It takes a `VACUUM INTO` snapshot with the container's own binary (safe while
the app runs), copies it to `PIXELSORT_BACKUP_REMOTE/db/pixelsort-YYYY-MM-DD.db`, copies the **result images of starred runs** to `…/starred/`, and keeps the
last 14 snapshots. Other images are regenerable from their recipes and are not backed up. Run it once by hand and check the remote:
```bash
systemctl start pixelsort-backup.service && journalctl -u pixelsort-backup.service -n 5
```
To restore: stop the container, copy a snapshot over `data/pixelsort.db`, delete `data/pixelsort.db-wal` and `-shm`, start it.

## Meridian

Three snippets in `deploy/meridian/` add a target (with an update action), an observed unit, and a health tile. Apply them to Meridian's own config by hand.

The tile shows three vitals:

| Vital | Source | Reads |
|---|---|---|
| `build` | `GET /healthz` | the version stamp, for example `r126.28cd968` |
| `disk` | `GET /api/usage` | `used_bytes` of `budget_bytes`, as a percentage |
| `archive` | `GET /api/usage` | `runs`: the number of pictures in the Archive (the Bin is counted separately as `trash_runs` and is not shown) |

All three read `http://localhost:8895`, so there is no new endpoint, no network beyond `localhost`, and no credentials. The `archive` number changes after a
save, a trash and an empty within Meridian's normal poll interval. After applying the snippet, check that Meridian still accepts the tile:

```bash
sudo cat /etc/meridian/targets.json | docker exec -i meridian /meridian doctor --allowlist -
```

The Pixelsort tile's vitals should still report `vital_ok`. The homelab repository's `docs/meridian.md` vital table and `docs/pixelsort.md` are not in this
repository: add the `archive` row to the table there when you apply the snippet.

## Security, in short

The container makes outside calls only to its own Cloudflare Worker, carrying only what you explicitly share or fetch. It never contacts GHCR (only the watcher
on the host does) and cannot name an image. It has no accounts: access is the tailnet. "Unlisted" share links are not private. The container runs read-only
with all capabilities dropped and `no-new-privileges`.

## Drafted text for the homelab repository

Copy these in after you approve (nobody edits the homelab repo for you).

**`docs/pixelsort.md`**

> # Pixelsort
> A pixel sorter that runs in the browser, with a small gallery server. Container `pixelsort`, port **8895** on `127.0.0.1`, served over Tailscale.
> Checkout `~/Pixelsort`; data in `~/Pixelsort/data`; signal folder `~/Pixelsort/update-signal`. Updates: Settings → Updates in the app, Meridian, or
> `systemctl start pixelsort-update.service`. Backups: `pixelsort-backup.timer` nightly to the configured rclone remote. Logs: `docker compose logs pixelsort`,
> `journalctl -u pixelsort-update.service`.

**Port map row**

> | 8895 | pixelsort | `127.0.0.1` only, `tailscale serve` | reserved |
