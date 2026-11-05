#!/usr/bin/env bash
# Nightly backup (PLAN.md section 6, decision D7): a snapshot of the database plus the result images of starred runs,
# copied to a remote with rclone. Everything else (originals, other results) is regenerable from recipes. Keeps the
# last 14 snapshots on the remote. Exits non-zero on any failure and logs one summary line.
set -euo pipefail

DIR="${PIXELSORT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DATA="${PIXELSORT_DATA_DIR:-$DIR/data}"
KEEP="${PIXELSORT_BACKUP_KEEP:-14}"
REMOTE="${PIXELSORT_BACKUP_REMOTE:-}"
if [ -z "$REMOTE" ] && [ -f "$DIR/.env" ]; then
  REMOTE="$(sed -n 's/^PIXELSORT_BACKUP_REMOTE=\(.*\)$/\1/p' "$DIR/.env" | tail -1)"
fi
if [ -z "$REMOTE" ]; then
  echo "backup: PIXELSORT_BACKUP_REMOTE is not set (for example r2:backups/pixelsort); set it in .env" >&2
  exit 2
fi
REMOTE="${REMOTE%/}"
cd "$DIR"

stamp="$(date -u +%Y-%m-%d)"
name="pixelsort-$stamp.db"
list="$(mktemp)"
trap 'rm -f "$list"' EXIT

mkdir -p "$DATA/backups"
timeout 120 docker compose exec -T pixelsort /app/pixelsort-go snapshot --data /data --out /data/backups/nightly.db >/dev/null
timeout 120 rclone copyto "$DATA/backups/nightly.db" "$REMOTE/db/$name"

timeout 60 docker compose exec -T pixelsort /app/pixelsort-go starred-list --data /data >"$list"
starred="$(wc -l <"$list" | tr -d ' ')"
if [ "$starred" -gt 0 ]; then
  timeout 600 rclone copy --files-from "$list" "$DATA" "$REMOTE/starred"
fi

# retention: keep the newest $KEEP snapshots (the names sort by date)
removed=0
mapfile -t snapshots < <(timeout 60 rclone lsf "$REMOTE/db" | sort)
excess=$((${#snapshots[@]} - KEEP))
if [ "$excess" -gt 0 ]; then
  for old in "${snapshots[@]:0:$excess}"; do
    timeout 60 rclone deletefile "$REMOTE/db/$old"
    removed=$((removed + 1))
  done
fi

echo "backup ok: $name, $starred starred result(s), $removed old snapshot(s) removed, remote $REMOTE"
