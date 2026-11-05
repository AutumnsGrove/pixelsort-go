#!/usr/bin/env bash
# Sets up a checkout of pixelsort-go to run as a service: data and signal folders, a .env (only if there is none), the
# systemd units for the update watcher and the nightly backup. Idempotent: run it again after `git pull` to refresh the
# units. It never overwrites .env. Run it as the deploy user (it uses sudo only to write into /etc/systemd/system).
set -euo pipefail

checkout="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
user="${PIXELSORT_USER:-$(id -un)}"
uid="$(id -u "$user")"
gid="$(id -g "$user")"
unit_dir="${PIXELSORT_UNIT_DIR:-/etc/systemd/system}"
systemctl_cmd="${PIXELSORT_SYSTEMCTL:-systemctl}"
sudo_cmd="${PIXELSORT_SUDO-sudo}" # empty (set, but empty) means "do not use sudo", for tests and root installs

as_root() { if [ -n "$sudo_cmd" ]; then "$sudo_cmd" "$@"; else "$@"; fi; }

echo "checkout: $checkout (user $user, uid $uid, gid $gid)"

# 1. folders owned by the deploy user
mkdir -p "$checkout/data" "$checkout/update-signal"
chmod 700 "$checkout/update-signal"

# 2. .env, only if absent; the container runs as this uid/gid so the watcher and the backup can read ./data
if [ ! -f "$checkout/.env" ]; then
  cp "$checkout/deploy/.env.example" "$checkout/.env"
  chmod 600 "$checkout/.env"
  echo "wrote .env from the example: set the digest, the Worker URL and secret"
fi
for kv in "PIXELSORT_UID=$uid" "PIXELSORT_GID=$gid"; do
  key="${kv%%=*}"
  if grep -q "^$key=" "$checkout/.env"; then
    sed -i "s/^$key=.*/$kv/" "$checkout/.env"
  else
    printf '%s\n' "$kv" >>"$checkout/.env"
  fi
done

# 3. units, with the checkout path and user filled in
chmod +x "$checkout"/deploy/watcher/update.sh "$checkout"/deploy/backup/backup.sh 2>/dev/null || true
staged="$(mktemp -d)"
trap 'rm -rf "$staged"' EXIT
for f in "$checkout"/deploy/watcher/*.path "$checkout"/deploy/watcher/*.service "$checkout"/deploy/watcher/*.timer \
         "$checkout"/deploy/backup/*.service "$checkout"/deploy/backup/*.timer; do
  [ -e "$f" ] || continue
  sed -e "s#@CHECKOUT@#$checkout#g" -e "s#@USER@#$user#g" "$f" >"$staged/$(basename "$f")"
  as_root install -m 0644 "$staged/$(basename "$f")" "$unit_dir/$(basename "$f")"
done

# 4. start watching
as_root "$systemctl_cmd" daemon-reload
as_root "$systemctl_cmd" enable --now pixelsort-update.path pixelsort-tick.timer
if [ -f "$unit_dir/pixelsort-backup.timer" ]; then
  as_root "$systemctl_cmd" enable --now pixelsort-backup.timer
fi
echo "done. Next: set PIXELSORT_IMAGE_DIGEST in .env, then: docker compose up -d"
