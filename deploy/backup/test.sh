#!/usr/bin/env bash
# Tests backup.sh against a fake docker and a fake rclone that keeps its "remote" in a folder.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="$here/backup.sh"
pass=0
fail=0
chk() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then pass=$((pass + 1)); echo "ok   $d"; else fail=$((fail + 1)); echo "FAIL $d"; fi; }

setup() {
  T="$(mktemp -d)"
  export PIXELSORT_DIR="$T/pix" PIXELSORT_DATA_DIR="$T/pix/data" CALLS="$T/calls" REMOTE_ROOT="$T/remote"
  mkdir -p "$PIXELSORT_DATA_DIR/images/ab" "$REMOTE_ROOT/db" "$T/bin"
  : >"$CALLS"
  printf 'result-one' >"$PIXELSORT_DATA_DIR/images/ab/abc1.png"
  printf 'result-two' >"$PIXELSORT_DATA_DIR/images/ab/abc2.png"
  unset FAKE_RCLONE_FAIL PIXELSORT_BACKUP_REMOTE
  cat >"$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >>"$CALLS"
case "$*" in
  *snapshot*) printf 'snapshot-bytes' >"$PIXELSORT_DATA_DIR/backups/nightly.db"; exit 0 ;;
  *starred-list*) [ -n "${FAKE_STARRED:-}" ] && printf '%s\n' images/ab/abc1.png images/ab/abc2.png; exit 0 ;;
esac
EOF
  cat >"$T/bin/rclone" <<'EOF'
#!/usr/bin/env bash
echo "rclone $*" >>"$CALLS"
[ "${FAKE_RCLONE_FAIL:-}" = 1 ] && { echo "rclone: network unreachable" >&2; exit 1; }
local_path() { echo "$REMOTE_ROOT/${1#*:}"; }
case "$1" in
  copyto) mkdir -p "$(dirname "$(local_path "$3")")"; cp "$2" "$(local_path "$3")" ;;
  copy)
    # copy --files-from LIST SRC DST
    dst="$(local_path "$5")"; mkdir -p "$dst"
    while read -r f; do cp "$4/$f" "$dst/"; done <"$3" ;;
  lsf) ls "$(local_path "$2")" 2>/dev/null ;;
  deletefile) rm -f "$(local_path "$2")" ;;
esac
EOF
  cat >"$T/bin/timeout" <<'EOF'
#!/usr/bin/env bash
shift
exec "$@"
EOF
  chmod +x "$T/bin"/*
  export PATH="$T/bin:$PATH_ORIG"
}
PATH_ORIG="$PATH"
line() { grep -n -- "$1" "$CALLS" | head -1 | cut -d: -f1; }

chk "set -euo pipefail"                           grep -q '^set -euo pipefail' "$script"
chk "bash -n"                                     bash -n "$script"

# ---- a normal night with starred results
setup; export PIXELSORT_BACKUP_REMOTE="r2:backups/pixelsort" FAKE_STARRED=1
out="$(bash "$script" 2>&1)"
chk "success: exit 0"                             test $? -eq 0
chk "success: one summary line"                   test "$(printf '%s\n' "$out" | grep -c 'backup ok')" -eq 1
chk "success: the snapshot is called before the copy" test "$(line 'snapshot')" -lt "$(line 'rclone copyto')"
chk "success: the snapshot uses the container's binary" grep -q 'docker compose exec -T pixelsort /app/pixelsort-go snapshot' "$CALLS"
chk "success: the snapshot lands on the remote with the date" ls "$REMOTE_ROOT/backups/pixelsort/db/pixelsort-$(date -u +%F).db"
chk "success: the snapshot bytes arrived"         grep -q 'snapshot-bytes' "$REMOTE_ROOT/backups/pixelsort/db/pixelsort-$(date -u +%F).db"
chk "success: the starred list was asked for"     grep -q 'starred-list' "$CALLS"
chk "success: starred results copied with --files-from" grep -q 'rclone copy --files-from' "$CALLS"
chk "success: both starred results arrived"       bash -c "[ -e '$REMOTE_ROOT/backups/pixelsort/starred/abc1.png' ] && [ -e '$REMOTE_ROOT/backups/pixelsort/starred/abc2.png' ]"
chk "success: summary names the count"            grep -q '2 starred' <<<"$out"

# ---- no starred runs: nothing to copy, still succeeds
setup; export PIXELSORT_BACKUP_REMOTE="r2:b" FAKE_STARRED=""
out="$(bash "$script" 2>&1)"
chk "no starred: exit 0"                          test $? -eq 0
chk "no starred: no starred copy attempted"       bash -c "! grep -q 'files-from' '$CALLS'"
chk "no starred: says 0"                          grep -q '0 starred' <<<"$out"

# ---- retention keeps 14
setup; export PIXELSORT_BACKUP_REMOTE="r2:b" FAKE_STARRED=""
for d in $(seq -w 1 20); do touch "$REMOTE_ROOT/b/db/pixelsort-2026-01-$d.db" 2>/dev/null || { mkdir -p "$REMOTE_ROOT/b/db"; touch "$REMOTE_ROOT/b/db/pixelsort-2026-01-$d.db"; }; done
bash "$script" >/dev/null 2>&1
chk "retention: exactly 14 snapshots remain"      test "$(ls "$REMOTE_ROOT/b/db" | wc -l)" -eq 14
chk "retention: the oldest were deleted"          test ! -e "$REMOTE_ROOT/b/db/pixelsort-2026-01-01.db"
chk "retention: today's snapshot was kept"        test -e "$REMOTE_ROOT/b/db/pixelsort-$(date -u +%F).db"
chk "retention: 7 deletions (20 old + 1 new - 14)" test "$(grep -c 'rclone deletefile' "$CALLS")" -eq 7

setup; export PIXELSORT_BACKUP_REMOTE="r2:b" FAKE_STARRED=""
for d in 01 02 03; do mkdir -p "$REMOTE_ROOT/b/db"; touch "$REMOTE_ROOT/b/db/pixelsort-2026-01-$d.db"; done
bash "$script" >/dev/null 2>&1
chk "retention: fewer than 14 deletes nothing"    bash -c "! grep -q 'deletefile' '$CALLS'"

# ---- failures are loud
setup; export PIXELSORT_BACKUP_REMOTE="r2:b" FAKE_STARRED=1 FAKE_RCLONE_FAIL=1
bash "$script" >"$T/out" 2>&1
code=$?
chk "rclone fails: the script fails"              test "$code" -ne 0
chk "rclone fails: no 'backup ok' line"           bash -c "! grep -q 'backup ok' '$T/out'"

setup
bash "$script" >"$T/out" 2>&1
code=$?
chk "no remote configured: exit 2"                test "$code" -eq 2
chk "no remote configured: a clear message"       grep -q 'PIXELSORT_BACKUP_REMOTE is not set' "$T/out"
chk "no remote configured: nothing ran"           bash -c "! grep -q . '$CALLS'"

setup; mkdir -p "$PIXELSORT_DIR"; echo 'PIXELSORT_BACKUP_REMOTE=r2:fromenv' >"$PIXELSORT_DIR/.env"; export FAKE_STARRED=""
bash "$script" >/dev/null 2>&1
chk "the remote can come from .env"               test -e "$REMOTE_ROOT/fromenv/db/pixelsort-$(date -u +%F).db"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
