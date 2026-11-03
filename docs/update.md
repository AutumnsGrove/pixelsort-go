# In-app updates

How pixelsort-go updates itself on the potato. One button in **Settings → Updates**, or Meridian's tap, or a command by hand: all three run the same watcher. This copies [Warbler's `docs/update.md`](../../Warbler/docs/update.md) (itself modelled on Polaris and Ivy); only the differences are written out here. The working mockup is `mockups/shared/updater.js`, tested by `mockups/tests/updater.mjs`.

## The rules (all inherited)

- The app runs locked down and cannot control Docker. It writes small **signal files** into a shared folder; a **watcher** on the host (a systemd path unit plus a oneshot service, running as the deploy user, not root) does the real work.
- The app **never names an image**. The watcher has `ghcr.io/autumnsgrove/pixelsort` written into it and only accepts that repository plus `@sha256:` and 64 lowercase hex characters. The only content the app may write into `requested` is the word `latest`.
- Update order in the watcher: resolve `:latest` to a digest, wait up to 60 s for `/api/busy` to say no upload is running, **snapshot the SQLite database** (`pixelsort snapshot` writes `data/backups/pre-update.db`), pin the digest in `.env`, pull, recreate, poll health for up to 120 s. Healthy: result `ok`. Unhealthy: restore the snapshot, pin the old digest, recreate, result `failed` with `rollback: "ok"` or `"failed"`.
- One run at a time (`flock`), every command has a timeout, a result file is written on **every** exit path, every control character in the result message becomes a space so the file is always valid JSON.
- The version string is `r<commit count>.<short sha>`, stamped in at build time and served by `GET /healthz`.

## Differences from Warbler

| | Warbler | pixelsort-go |
|---|---|---|
| Outbound traffic | The container never goes online; only the watcher does | The container already has a route out (the Worker relay). It still **never contacts GHCR**: only the watcher does, so the "app can't name an image" rule holds either way |
| What blocks Update | A phone session recording | An **export in progress** (it runs in the browser, so only the page knows) or a run still saving. The server-side `/api/busy` covers uploads; the page covers exports. "Finish your export first." |
| The open page | Reloads when the version changes | Same, plus: **an old tab keeps the old page and the old WASM engine.** The page remembers the version it loaded; when `/healthz` reports a different one it offers "A newer version is ready — reload" instead of carrying on with a mismatched engine (`Updater.staleTab`) |
| Database | Stub until Phase 2 | SQLite in WAL mode: the snapshot uses `VACUUM INTO`, which is safe while the app runs |

## The flow

```
Settings → [Check]    → update-signal/check       → watcher writes available.json
Settings → [Update]   → update-signal/requested   → watcher updates, writes result
Meridian tap / by hand → systemctl start pixelsort-update.service   (no file: "update to latest")
```

The page is served by the container being replaced, so while updating it polls `/healthz`, expects the server to vanish for a while ("Pixelsort is restarting. This page will carry on by itself."), and reloads once the version changes.

## Signal folder and endpoints

`~/Pixelsort/update-signal/` on the host, `/data/update-signal` in the container. Files are written to a temporary name and renamed into place. Files: `check`, `available.json`, `requested`, `result`, `heartbeat`, exactly as in Warbler.

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | `{"status":"ok","version":"r123.abc1234"}`, nothing else |
| `GET /api/version` | version, deployment (`docker`), updater state (`ready` / `not installed`), heartbeat age |
| `POST /api/update/check` · `GET /api/update/available` | write `check` · read `available.json` |
| `POST /api/update/start` | writes `requested`; **rejects any body but `latest`** |
| `GET /api/update/status` | `result` and whether `requested` still exists |
| `GET /api/busy` | loopback only: `{"busy":true}` while an upload is running |

## What Settings shows (`deriveView`)

| State | Says | Buttons |
|---|---|---|
| up to date | "Up to date." + when last checked | Check for updates |
| checking | "Checking for a newer version…" | none |
| available | "A newer version is ready." Version, plus "your runs are backed up first, and if it doesn't start the old one comes back" | Update now (disabled with a reason while an export runs) |
| updating | "Updating. This takes a minute." After 5 min: "taking longer than expected" | none |
| done | "Updated to r14.9a1c4e2. Reloading." | none |
| failed | "The update didn't work." The previous version is running again, plus the watcher's reason | Try again |
| failed, rollback failed | "…Pixelsort may not be running properly. Check the server." | none |
| no updater / quiet watcher | "Updates aren't set up on this server." (or "has gone quiet" after 30 min without a heartbeat) | none |
| no answer | The request vanished and 90 s passed with no result: reported as a failure, never as silence | Try again |

A `result` older than this run's request is never read as this run's answer.

## Not decided

- The same four points as Warbler: confirm the port, the folder name, whether the Meridian additions go in as a PR, and make the first GHCR package public.
- Whether the watcher should also `git pull` the checkout (Polaris does; Warbler doesn't yet). Compose file, watcher script and units come from the checkout, so a change to them needs `git pull && deploy/install.sh` by hand until it does.
