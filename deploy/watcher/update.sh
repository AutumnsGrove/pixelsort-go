#!/usr/bin/env bash
# The host-side update watcher (docs/update.md). Runs as the deploy user, never as root.
#
#   update.sh            update to the newest image (also what a bare start by Meridian or by hand means)
#   update.sh --tick     refresh the heartbeat; act only if a signal file exists (never updates on its own)
#
# Signal folder (default $PIXELSORT_DIR/update-signal): check, available.json, requested, result, heartbeat.
# The app only ever writes `check` and `requested` (containing the word "latest"). The repository below is written into
# this script on purpose: the app can never name an image.
set -euo pipefail

REPO="ghcr.io/autumnsgrove/pixelsort"
GHCR_PATH="autumnsgrove/pixelsort"
DIR="${PIXELSORT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SIG="${PIXELSORT_SIGNAL_DIR:-$DIR/update-signal}"
ENV_FILE="$DIR/.env"
DATA="${PIXELSORT_DATA_DIR:-$DIR/data}"
BUSY_WAIT="${PIXELSORT_BUSY_WAIT:-60}"
HEALTH_WAIT="${PIXELSORT_HEALTH_WAIT:-120}"
DIGEST_RE='^sha256:[0-9a-f]{64}$'
TAG_RE='^[A-Za-z0-9._-]{1,64}$'

mkdir -p "$SIG"
cd "$DIR"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Every control character becomes a space, quotes and backslashes are escaped: the result file is always valid JSON.
clean() { printf '%s' "$1" | tr '\000-\037\177' ' ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | cut -c1-600; }

# Write a file in the signal folder atomically (temporary name, then rename).
put() { # put <name> <content>
  local tmp
  tmp="$(mktemp "$SIG/.$1.XXXXXX")"
  printf '%s\n' "$2" >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$SIG/$1"
}

env_value() { # env_value <KEY>: the value of KEY in .env, empty if unset
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=\(.*\)$/\1/p" "$ENV_FILE" | tail -1
}

# Change exactly one line of .env (the digest pin); nothing else in the file is touched.
pin() { # pin <digest>
  local tmp
  tmp="$(mktemp "$DIR/.env.XXXXXX")"
  if grep -q '^PIXELSORT_IMAGE_DIGEST=' "$ENV_FILE" 2>/dev/null; then
    sed "s/^PIXELSORT_IMAGE_DIGEST=.*/PIXELSORT_IMAGE_DIGEST=$1/" "$ENV_FILE" >"$tmp"
  else
    { cat "$ENV_FILE" 2>/dev/null || true; printf 'PIXELSORT_IMAGE_DIGEST=%s\n' "$1"; } >"$tmp"
  fi
  chmod --reference="$ENV_FILE" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
}

short() { printf '%s' "${1#sha256:}" | cut -c1-12; }

# Run a command, keeping its output for the failure message (the last line only; `clean` makes it safe for JSON).
LOGF="$SIG/.last-output"
logged() { "$@" >"$LOGF" 2>&1; }
last_line() { [ -s "$LOGF" ] && tail -n 1 "$LOGF" | cut -c1-200 || true; }
why() { # why <message>: the message plus the last line of the failed command's output, if any
  local tail
  tail="$(last_line)"
  if [ -n "$tail" ]; then printf '%s (%s)' "$1" "$tail"; else printf '%s' "$1"; fi
}

# ---- GHCR: the only place the script goes online; it resolves the digest itself ----
resolve_digest() { # resolve_digest <tag> -> prints sha256:...
  local tag="$1" token digest
  token="$(timeout 15 curl -fsS "https://ghcr.io/token?service=ghcr.io&scope=repository:$GHCR_PATH:pull" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')" || return 1
  [ -n "$token" ] || return 1
  digest="$(timeout 15 curl -fsSI \
    -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://ghcr.io/v2/$GHCR_PATH/manifests/$tag" | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: *//p' | head -1)" || return 1
  [[ "$digest" =~ $DIGEST_RE ]] || return 1
  printf '%s' "$digest"
}

wanted_tag() {
  local tag
  tag="$(env_value PIXELSORT_UPDATE_TAG)"
  [ -n "$tag" ] || tag=latest
  [[ "$tag" =~ $TAG_RE ]] || return 1
  printf '%s' "$tag"
}

# ---- the container ----
healthy() {
  local id status
  id="$(timeout 30 docker compose ps -q pixelsort 2>/dev/null)" || return 1
  [ -n "$id" ] || return 1
  status="$(timeout 30 docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null)" || return 1
  [ "$status" = healthy ]
}

wait_healthy() {
  local waited=0
  while [ "$waited" -lt "$HEALTH_WAIT" ]; do
    healthy && return 0
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

wait_not_busy() {
  local port waited=0
  port="$(env_value PIXELSORT_PORT)"
  port="${port:-8895}"
  while [ "$waited" -lt "$BUSY_WAIT" ]; do
    if timeout 5 curl -fsS "http://127.0.0.1:$port/api/busy" 2>/dev/null | grep -q '"busy": *false'; then return 0; fi
    sleep 2
    waited=$((waited + 2))
  done
  return 0 # still busy after the wait: go on anyway; the snapshot is safe while the app runs
}

# ---- results ----
STATUS=failed DETAIL="The update did not finish." ROLLBACK=none TARGET="" RESULT_ON_EXIT=0

write_result() {
  put result "{\"status\":\"$STATUS\",\"detail\":\"$(clean "$DETAIL")\",\"rollback\":\"$ROLLBACK\",\"target\":\"$TARGET\",\"finished_at\":\"$(now)\"}"
}

# On every exit path of an update: write the result, and remove `requested` as the very last step.
finish() {
  local code=$?
  if [ "$RESULT_ON_EXIT" = 1 ]; then
    write_result || true
    rm -f "$SIG/requested"
  fi
  exit "$code"
}

fail() { # fail <detail> [rollback]
  STATUS=failed
  DETAIL="$1"
  ROLLBACK="${2:-none}"
  exit 0 # the EXIT trap writes the result; a failed update is a normal outcome, not a script error
}

# Put the database and the old image back.
rollback() { # rollback <old digest>
  local old="$1" ok=1
  timeout 60 docker compose stop || ok=0
  if [ -f "$DATA/backups/pre-update.db" ]; then
    cp -f "$DATA/backups/pre-update.db" "$DATA/pixelsort.db" || ok=0
    rm -f "$DATA/pixelsort.db-wal" "$DATA/pixelsort.db-shm"
  fi
  pin "$old"
  timeout 60 docker compose up -d --force-recreate || ok=0
  if [ "$ok" = 1 ] && wait_healthy; then ROLLBACK=ok; else ROLLBACK=failed; fi
}

do_check() {
  local tag digest current avail
  tag="$(wanted_tag)" || { rm -f "$SIG/check"; return 0; }
  if digest="$(resolve_digest "$tag")"; then
    current="$(env_value PIXELSORT_IMAGE_DIGEST)"
    avail=false
    [ "$digest" != "$current" ] && avail=true
    put available.json "{\"current\":\"$(short "$current")\",\"latest\":\"$(short "$digest")\",\"latest_digest\":\"$digest\",\"checked_at\":\"$(now)\",\"update_available\":$avail}"
  fi
  rm -f "$SIG/check"
}

do_update() {
  local tag digest old
  RESULT_ON_EXIT=1
  trap finish EXIT

  tag="$(wanted_tag)" || fail "PIXELSORT_UPDATE_TAG in .env is not a valid tag."
  digest="$(resolve_digest "$tag")" || fail "Could not look up the newest version (is the server online?). Nothing was changed."
  if ! [[ "$REPO@$digest" =~ ^ghcr\.io/autumnsgrove/pixelsort@sha256:[0-9a-f]{64}$ ]]; then
    fail "Refused an image reference that is not ghcr.io/autumnsgrove/pixelsort@sha256:<64 hex>."
  fi
  TARGET="$(short "$digest")"
  old="$(env_value PIXELSORT_IMAGE_DIGEST)"

  if [ "$digest" = "$old" ]; then
    STATUS=skipped DETAIL="Already up to date." ROLLBACK=none
    return 0
  fi

  wait_not_busy
  mkdir -p "$DATA/backups"
  logged timeout 60 docker compose exec -T pixelsort /app/pixelsort-go snapshot --data /data --out /data/backups/pre-update.db \
    || fail "$(why "Could not back up the database first, so nothing was changed.")"

  pin "$digest"
  if ! logged timeout 300 docker compose pull; then
    pin "$old"
    fail "$(why "Could not download the new version. The previous version is still running.")"
  fi
  if ! logged timeout 60 docker compose up -d --force-recreate; then
    local msg
    msg="$(why "The new version did not start. Went back to the previous one.")"
    rollback "$old"
    fail "$msg" "$ROLLBACK"
  fi
  if wait_healthy; then
    STATUS=ok DETAIL="" ROLLBACK=none
    return 0
  fi
  rollback "$old"
  if [ "$ROLLBACK" = ok ]; then
    fail "The new version did not become healthy in ${HEALTH_WAIT} seconds. Restored the backup and started the previous version." ok
  fi
  fail "The new version did not start, and the previous version did not start either. Pixelsort may not be running properly. Check the server." failed
}

main() {
  local mode=update
  if [ "${1:-}" = "--tick" ]; then mode=tick; fi

  # One run at a time. A second trigger exits quietly.
  exec 9>"$SIG/.lock"
  flock -n 9 || exit 0

  if [ "$mode" = tick ]; then
    put heartbeat "$(now)"
    if [ -e "$SIG/check" ]; then do_check; exit 0; fi
    if [ -e "$SIG/requested" ]; then do_update; exit 0; fi
    exit 0
  fi

  put heartbeat "$(now)"
  if [ -e "$SIG/check" ] && [ ! -e "$SIG/requested" ]; then
    do_check
    exit 0
  fi
  do_update
}

main "$@"
