#!/usr/bin/env bash
# Tests update.sh against fake `docker`, `curl`, `timeout` and `sleep` placed first on PATH. The fakes read scenario
# variables and record every call. Nothing here touches Docker, the network, systemd or a real checkout.
#   bash deploy/watcher/test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/update.sh"
pass=0
fail=0

OLD="sha256:$(printf 'a%.0s' {1..64})"
NEW="sha256:$(printf 'b%.0s' {1..64})"

chk() { # chk <description> <command...>: passes when the command succeeds
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass=$((pass + 1))
    echo "ok   $desc"
  else
    fail=$((fail + 1))
    echo "FAIL $desc"
  fi
}

# ---- the fakes ----
write_fakes() {
  local bin="$1"
  mkdir -p "$bin"
  cat >"$bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >>"$CALLS"
# A fake sees whether `requested` still exists at each call: it must outlive every docker step.
[ -e "$PIXELSORT_SIGNAL_DIR/requested" ] && echo "requested-present" >>"$CALLS.requested" || echo "requested-absent" >>"$CALLS.requested"
digest_now() { sed -n 's/^PIXELSORT_IMAGE_DIGEST=//p' "$PIXELSORT_DIR/.env"; }
case "$*" in
  *"exec -T pixelsort"*snapshot*)
    [ "${FAKE_SNAP_FAIL:-}" = 1 ] && { printf 'snapshot: boom\twith\001control\n' >&2; exit 1; }
    mkdir -p "$PIXELSORT_DATA_DIR/backups"
    cat "$PIXELSORT_DATA_DIR/pixelsort.db" >"$PIXELSORT_DATA_DIR/backups/pre-update.db"
    exit 0 ;;
  *"compose pull"*)
    [ "${FAKE_PULL_FAIL:-}" = 1 ] && { printf 'pull: denied\tby\001registry\n' >&2; exit 1; }
    exit 0 ;;
  *"compose stop"*) exit 0 ;;
  *"compose up"*)
    d="$(digest_now)"
    if [ "$d" = "$FAKE_NEW" ] && [ "${FAKE_UP_FAIL:-}" = 1 ]; then echo "up: no such image" >&2; exit 1; fi
    if [ "$d" = "$FAKE_OLD" ] && [ "${FAKE_ROLLBACK_FAIL:-}" = 1 ]; then echo "up: cannot start old" >&2; exit 1; fi
    # a started container serves the new database: a bad update has already changed it
    [ "$d" = "$FAKE_NEW" ] && echo "migrated" >>"$PIXELSORT_DATA_DIR/pixelsort.db"
    echo "$d" >"$CALLS.running"
    exit 0 ;;
  *"compose ps -q"*) echo "cid123"; exit 0 ;;
  *"inspect"*)
    d="$(cat "$CALLS.running" 2>/dev/null)"
    if [ "$d" = "$FAKE_NEW" ] && [ "${FAKE_NEW_UNHEALTHY:-}" = 1 ]; then echo unhealthy; else echo healthy; fi
    exit 0 ;;
esac
exit 0
EOF
  cat >"$bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >>"$CALLS"
url="${*: -1}"
case "$url" in
  https://ghcr.io/token*)
    [ "${FAKE_GHCR_DOWN:-}" = 1 ] && exit 6
    echo '{"token":"tok123"}'; exit 0 ;;
  https://ghcr.io/v2/*/manifests/*)
    [ "${FAKE_GHCR_DOWN:-}" = 1 ] && exit 6
    printf 'HTTP/2 200\r\ncontent-type: application/vnd.oci.image.index.v1+json\r\nDocker-Content-Digest: %s\r\n\r\n' "${FAKE_DIGEST:-$FAKE_NEW}"
    exit 0 ;;
  http://127.0.0.1:*/api/busy)
    if [ "${FAKE_BUSY:-}" = true ]; then echo '{"busy": true}'; else echo '{"busy": false}'; fi
    exit 0 ;;
esac
exit 22
EOF
  cat >"$bin/timeout" <<'EOF'
#!/usr/bin/env bash
n="$1"
shift
echo "timeout $n $*" >>"$CALLS"
if [ -n "${FAKE_TIMEOUT_MATCH:-}" ] && [[ "$*" == *"$FAKE_TIMEOUT_MATCH"* ]]; then
  # FAKE_TIMEOUT_ONCE: only the first matching command times out (so a rollback can succeed afterwards)
  if [ -z "${FAKE_TIMEOUT_ONCE:-}" ] || [ ! -e "$CALLS.timedout" ]; then touch "$CALLS.timedout"; exit 124; fi
fi
exec "$@"
EOF
  cat >"$bin/sleep" <<'EOF'
#!/usr/bin/env bash
echo "sleep $*" >>"$CALLS"
exit 0
EOF
  chmod +x "$bin"/*
}

# ---- a fresh checkout per case ----
setup() {
  T="$(mktemp -d)"
  export PIXELSORT_DIR="$T/pix" PIXELSORT_SIGNAL_DIR="$T/pix/update-signal" PIXELSORT_DATA_DIR="$T/pix/data"
  export CALLS="$T/calls" FAKE_OLD="$OLD" FAKE_NEW="$NEW"
  unset FAKE_TIMEOUT_ONCE FAKE_SNAP_FAIL FAKE_PULL_FAIL FAKE_UP_FAIL FAKE_ROLLBACK_FAIL FAKE_NEW_UNHEALTHY FAKE_GHCR_DOWN FAKE_DIGEST FAKE_BUSY FAKE_TIMEOUT_MATCH
  mkdir -p "$PIXELSORT_DIR" "$PIXELSORT_SIGNAL_DIR" "$PIXELSORT_DATA_DIR"
  : >"$CALLS"
  : >"$CALLS.requested"
  printf 'original database\n' >"$PIXELSORT_DATA_DIR/pixelsort.db"
  cat >"$PIXELSORT_DIR/.env" <<EOF2
# a comment that must survive
PIXELSORT_IMAGE_DIGEST=$OLD
PIXELSORT_PORT=8895
PIXELSORT_WORKER_SECRET=keep-this-exactly
PIXELSORT_UPDATE_TAG=latest
EOF2
  echo "$OLD" >"$CALLS.running"
  write_fakes "$T/bin"
  export PATH="$T/bin:$PATH_ORIG"
  export PIXELSORT_BUSY_WAIT=6 PIXELSORT_HEALTH_WAIT=6
}
PATH_ORIG="$PATH"

run() { bash "$script" "$@" >"$T/out" 2>&1; }
result() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$PIXELSORT_SIGNAL_DIR/result"; }
valid_json() { python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1"; }
digest_in_env() { sed -n 's/^PIXELSORT_IMAGE_DIGEST=//p' "$PIXELSORT_DIR/.env"; }
called() { grep -q -- "$1" "$CALLS"; }
line_no() { grep -n -- "$1" "$CALLS" | head -1 | cut -d: -f1; }
no_docker() { ! grep -q '^docker ' "$CALLS"; }
others_unchanged() { # every line of .env except the digest is exactly as it was
  diff <(grep -v '^PIXELSORT_IMAGE_DIGEST=' "$PIXELSORT_DIR/.env") \
       <(printf '# a comment that must survive\nPIXELSORT_PORT=8895\nPIXELSORT_WORKER_SECRET=keep-this-exactly\nPIXELSORT_UPDATE_TAG=latest\n')
}

# ============================================================ the script itself
chk "set -euo pipefail"                         grep -q '^set -euo pipefail' "$script"
chk "no jq dependency"                          bash -c "! grep -q 'jq' '$script'"
chk "flock -n for one run at a time"            grep -q 'flock -n' "$script"
chk "the repository is written into the script" grep -q '^REPO="ghcr.io/autumnsgrove/pixelsort"' "$script"
chk "every compose command has a timeout"       bash -c "! grep -E '^[^#]*docker compose' '$script' | grep -vE 'timeout [0-9]+ docker|echo|#|compose ps|healthy' | grep -q ."
chk "runs fine under bash -n"                   bash -n "$script"

# ============================================================ a bare start updates
setup; run
chk "bare start: exit 0"                        test $? -eq 0
chk "bare start: result ok"                     test "$(result status)" = ok
chk "bare start: result is valid JSON"          valid_json "$PIXELSORT_SIGNAL_DIR/result"
chk "bare start: target is the new digest (12)" test "$(result target)" = "$(printf 'b%.0s' {1..12})"
chk "bare start: rollback none"                 test "$(result rollback)" = none
chk "bare start: finished_at is RFC 3339"       grep -Eq '"finished_at":"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z"' "$PIXELSORT_SIGNAL_DIR/result"
chk "bare start: the new digest is pinned"      test "$(digest_in_env)" = "$NEW"
chk "bare start: no other .env line changed"    others_unchanged
chk "bare start: heartbeat written"             test -s "$PIXELSORT_SIGNAL_DIR/heartbeat"
chk "bare start: snapshot before pull"          test "$(line_no 'snapshot')" -lt "$(line_no 'compose pull')"
chk "bare start: pull before recreate"          test "$(line_no 'compose pull')" -lt "$(line_no 'compose up')"
chk "bare start: snapshot written by the app"   test -s "$PIXELSORT_DATA_DIR/backups/pre-update.db"
chk "bare start: pull has a 300 s timeout"      called 'timeout 300 docker compose pull'
chk "bare start: recreate has a 60 s timeout"   called 'timeout 60 docker compose up -d --force-recreate'
chk "bare start: snapshot has a 60 s timeout"   called 'timeout 60 docker compose exec'
chk "bare start: GHCR lookups have 15 s timeouts" called 'timeout 15 curl'
chk "bare start: asked the busy endpoint"       called '/api/busy'
chk "bare start: only ghcr.io/autumnsgrove/pixelsort was contacted" bash -c "! grep -E '^curl' '$CALLS' | grep -E 'https://' | grep -v 'ghcr.io' | grep -q ."
chk "bare start: signal files are 0600"         bash -c "[ \"\$(stat -c %a '$PIXELSORT_SIGNAL_DIR/result')\" = 600 ]"
chk "bare start: no temporary files left"       bash -c "! ls -A '$PIXELSORT_SIGNAL_DIR' | grep -E '^\.(result|heartbeat|available)\.'"

# ============================================================ requested
setup; echo latest >"$PIXELSORT_SIGNAL_DIR/requested"; run
chk "requested: result ok"                      test "$(result status)" = ok
chk "requested: removed as the last step"       test ! -e "$PIXELSORT_SIGNAL_DIR/requested"
chk "requested: still present at every docker call" bash -c "! grep -q requested-absent '$CALLS.requested' && grep -q requested-present '$CALLS.requested'"

# ============================================================ check
setup; touch "$PIXELSORT_SIGNAL_DIR/check"; run
chk "check: available.json written"             valid_json "$PIXELSORT_SIGNAL_DIR/available.json"
chk "check: update_available true"              grep -q '"update_available":true' "$PIXELSORT_SIGNAL_DIR/available.json"
chk "check: latest_digest present"              grep -q "\"latest_digest\":\"$NEW\"" "$PIXELSORT_SIGNAL_DIR/available.json"
chk "check: current is the pinned digest (12)"  grep -q "\"current\":\"$(printf 'a%.0s' {1..12})\"" "$PIXELSORT_SIGNAL_DIR/available.json"
chk "check: the check file is removed"          test ! -e "$PIXELSORT_SIGNAL_DIR/check"
chk "check: no docker command ran"              no_docker
chk "check: .env untouched"                     test "$(digest_in_env)" = "$OLD"
chk "check: no result written"                  test ! -e "$PIXELSORT_SIGNAL_DIR/result"

setup; touch "$PIXELSORT_SIGNAL_DIR/check"; FAKE_DIGEST="$OLD" run
chk "check, nothing newer: update_available false" grep -q '"update_available":false' "$PIXELSORT_SIGNAL_DIR/available.json"

setup; touch "$PIXELSORT_SIGNAL_DIR/check"; FAKE_GHCR_DOWN=1 run
chk "check, GHCR down: still removes the check"  test ! -e "$PIXELSORT_SIGNAL_DIR/check"
chk "check, GHCR down: invents no available.json" test ! -e "$PIXELSORT_SIGNAL_DIR/available.json"

# ============================================================ nothing newer
setup; FAKE_DIGEST="$OLD" run
chk "up to date: result skipped"                test "$(result status)" = skipped
chk "up to date: says so"                       test "$(result detail)" = "Already up to date."
chk "up to date: no docker command ran"         no_docker

# ============================================================ refusals
setup; FAKE_DIGEST="sha256:xyz" run
chk "malformed digest: failed"                  test "$(result status)" = failed
chk "malformed digest: .env untouched"          test "$(digest_in_env)" = "$OLD"
chk "malformed digest: no docker command ran"   no_docker

setup; FAKE_DIGEST="sha256:$(printf 'B%.0s' {1..64})" run
chk "uppercase digest: refused"                 test "$(result status)" = failed

setup; FAKE_DIGEST="sha256:$(printf 'b%.0s' {1..63})" run
chk "short digest: refused"                     test "$(result status)" = failed

setup; REPO="ghcr.io/evil/img" PIXELSORT_IMAGE_REPO="ghcr.io/evil/img" run
chk "the repository cannot be overridden from the environment" bash -c "! grep -q 'evil' '$CALLS'"
chk "the manifest URL is the hard-coded repository" grep -q 'ghcr.io/v2/autumnsgrove/pixelsort/manifests/latest' "$CALLS"

setup; sed -i 's/^PIXELSORT_UPDATE_TAG=.*/PIXELSORT_UPDATE_TAG=latest;rm -rf \//' "$PIXELSORT_DIR/.env"; run
chk "a tag with a bad character: failed"        test "$(result status)" = failed
chk "a tag with a bad character: no network"    bash -c "! grep -q '^curl' '$CALLS'"
chk "a tag with a bad character: no docker"     no_docker

setup; sed -i 's/^PIXELSORT_UPDATE_TAG=.*/PIXELSORT_UPDATE_TAG=broken-test/' "$PIXELSORT_DIR/.env"; run
chk "a custom tag is followed"                  grep -q 'manifests/broken-test' "$CALLS"

# ============================================================ GHCR unreachable
setup; FAKE_GHCR_DOWN=1 run
chk "GHCR unreachable: failed"                  test "$(result status)" = failed
chk "GHCR unreachable: touches nothing"         bash -c "no_docker() { ! grep -q '^docker ' '$CALLS'; }; no_docker && [ \"\$(sed -n 's/^PIXELSORT_IMAGE_DIGEST=//p' '$PIXELSORT_DIR/.env')\" = '$OLD' ]"
chk "GHCR unreachable: result valid JSON"       valid_json "$PIXELSORT_SIGNAL_DIR/result"

# ============================================================ failures and rollback
setup; FAKE_SNAP_FAIL=1 run
chk "snapshot fails: failed"                    test "$(result status)" = failed
chk "snapshot fails: nothing was changed"       test "$(digest_in_env)" = "$OLD"
chk "snapshot fails: never pulled"              bash -c "! grep -q 'compose pull' '$CALLS'"
chk "snapshot fails: JSON still valid despite control characters in Docker's message" valid_json "$PIXELSORT_SIGNAL_DIR/result"

setup; FAKE_PULL_FAIL=1 run
chk "pull fails: failed"                        test "$(result status)" = failed
chk "pull fails: the old digest is pinned again" test "$(digest_in_env)" = "$OLD"
chk "pull fails: the container was never recreated" bash -c "! grep -q 'compose up' '$CALLS'"
chk "pull fails: rollback is none"              test "$(result rollback)" = none
chk "pull fails: JSON valid with a tab and control character in Docker's message" valid_json "$PIXELSORT_SIGNAL_DIR/result"
chk "pull fails: the reason is shown"           grep -q 'denied' "$PIXELSORT_SIGNAL_DIR/result"
chk "pull fails: requested removed anyway"      bash -c "[ ! -e '$PIXELSORT_SIGNAL_DIR/requested' ]"

setup; FAKE_UP_FAIL=1 run
chk "recreate fails: failed"                    test "$(result status)" = failed
chk "recreate fails: rolled back"               test "$(result rollback)" = ok
chk "recreate fails: old digest pinned"         test "$(digest_in_env)" = "$OLD"
chk "recreate fails: stopped the container"     called 'compose stop'
chk "recreate fails: restarted twice"           test "$(grep -c '^docker compose up' "$CALLS")" -eq 2
chk "recreate fails: .env otherwise untouched"  others_unchanged

setup; FAKE_NEW_UNHEALTHY=1 run
chk "unhealthy: failed"                         test "$(result status)" = failed
chk "unhealthy: rollback ok"                    test "$(result rollback)" = ok
chk "unhealthy: old digest pinned"              test "$(digest_in_env)" = "$OLD"
chk "unhealthy: the database was restored from the snapshot" test "$(cat "$PIXELSORT_DATA_DIR/pixelsort.db")" = "original database"
chk "unhealthy: -wal and -shm removed"          bash -c "touch '$PIXELSORT_DATA_DIR/x'; [ ! -e '$PIXELSORT_DATA_DIR/pixelsort.db-wal' ] && [ ! -e '$PIXELSORT_DATA_DIR/pixelsort.db-shm' ]"
chk "unhealthy: the message says the backup was restored" grep -q 'Restored the backup' "$PIXELSORT_SIGNAL_DIR/result"
chk "unhealthy: health polling slept between tries" called 'sleep 2'

setup; FAKE_NEW_UNHEALTHY=1 FAKE_ROLLBACK_FAIL=1 run
chk "rollback fails: failed"                    test "$(result status)" = failed
chk "rollback fails: rollback is failed"        test "$(result rollback)" = failed
chk "rollback fails: a distinct message"        grep -q 'may not be running properly' "$PIXELSORT_SIGNAL_DIR/result"
chk "rollback fails: still valid JSON"          valid_json "$PIXELSORT_SIGNAL_DIR/result"

# ============================================================ locking, busy, timeouts
setup
( flock 9; /usr/bin/sleep 4 ) 9>"$PIXELSORT_SIGNAL_DIR/.lock" & # the real sleep: the fake one on PATH returns at once
holder=$!
/usr/bin/sleep 0.5
echo latest >"$PIXELSORT_SIGNAL_DIR/requested"
run
code=$?
chk "second run while locked: exits 0"          test "$code" -eq 0
chk "second run while locked: writes no result" test ! -e "$PIXELSORT_SIGNAL_DIR/result"
chk "second run while locked: runs nothing"     no_docker
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null

setup; FAKE_BUSY=true run
chk "busy: waits then carries on"               test "$(result status)" = ok
chk "busy: slept while waiting (6 s of 2 s steps)" test "$(grep -c 'sleep 2' "$CALLS")" -ge 3

setup; FAKE_TIMEOUT_MATCH="compose pull" run
chk "pull times out: failed, old digest pinned" bash -c "[ \"$(result status)\" = failed ]"
chk "pull times out: old digest back"           test "$(digest_in_env)" = "$OLD"

setup; FAKE_TIMEOUT_MATCH="snapshot" run
chk "snapshot times out: failed, nothing changed" test "$(result status)" = failed
chk "snapshot times out: .env untouched"        test "$(digest_in_env)" = "$OLD"

setup; FAKE_TIMEOUT_MATCH="up -d" FAKE_TIMEOUT_ONCE=1 run
chk "recreate times out: rolled back"           test "$(result rollback)" = ok

setup; FAKE_TIMEOUT_MATCH="curl" run
chk "GHCR lookup times out: failed"             test "$(result status)" = failed

# ============================================================ --tick
setup; run --tick
chk "tick, no signal: exit 0"                   test $? -eq 0
chk "tick, no signal: heartbeat refreshed"      test -s "$PIXELSORT_SIGNAL_DIR/heartbeat"
chk "tick, no signal: no docker command"        no_docker
chk "tick, no signal: no network"               bash -c "! grep -q '^curl' '$CALLS'"
chk "tick, no signal: no result"                test ! -e "$PIXELSORT_SIGNAL_DIR/result"
chk "tick, no signal: .env untouched"           test "$(digest_in_env)" = "$OLD"

setup; touch "$PIXELSORT_SIGNAL_DIR/check"; run --tick
chk "tick with a check signal: does the check"  test -s "$PIXELSORT_SIGNAL_DIR/available.json"

setup; echo latest >"$PIXELSORT_SIGNAL_DIR/requested"; run --tick
chk "tick with a request: updates"              test "$(result status)" = ok

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -ge 50 ]
