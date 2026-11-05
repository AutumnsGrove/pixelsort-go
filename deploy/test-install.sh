#!/usr/bin/env bash
# Tests install.sh in a temporary checkout with a fake systemctl and a temporary unit folder.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
pass=0
fail=0
chk() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then pass=$((pass + 1)); echo "ok   $d"; else fail=$((fail + 1)); echo "FAIL $d"; fi; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
checkout="$T/Pixelsort"
mkdir -p "$checkout"
cp -r "$here" "$checkout/deploy" # install.sh works relative to its own checkout
mkdir -p "$T/units"
cat >"$T/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >>"$CALLS"
EOF
chmod +x "$T/systemctl"
export CALLS="$T/calls"
: >"$CALLS"
# Install for a user that is not root, whoever runs the test (CI runners and this sandbox may be root).
if id nobody >/dev/null 2>&1; then user=nobody; else user="$(id -un)"; fi
export PIXELSORT_UNIT_DIR="$T/units" PIXELSORT_SYSTEMCTL="$T/systemctl" PIXELSORT_SUDO="" PIXELSORT_USER="$user"

bash "$checkout/deploy/install.sh" >"$T/out" 2>&1
chk "first run succeeds"                          test $? -eq 0
chk "data folder created"                         test -d "$checkout/data"
chk "signal folder created, mode 700"             bash -c "[ \"\$(stat -c %a '$checkout/update-signal')\" = 700 ]"
chk ".env written from the example"               grep -q 'PIXELSORT_IMAGE_DIGEST' "$checkout/.env"
chk ".env is private (600)"                       bash -c "[ \"\$(stat -c %a '$checkout/.env')\" = 600 ]"
chk ".env got the deploy user's uid"              grep -q "^PIXELSORT_UID=$(id -u "$PIXELSORT_USER")$" "$checkout/.env"
chk ".env got the deploy user's gid"              grep -q "^PIXELSORT_GID=$(id -g "$PIXELSORT_USER")$" "$checkout/.env"
for u in pixelsort-update.path pixelsort-update.service pixelsort-tick.service pixelsort-tick.timer; do
  chk "unit installed: $u"                        test -s "$T/units/$u"
  chk "no placeholder left in $u"                 bash -c "! grep -q '@' '$T/units/$u'"
done
chk "the update service runs as the deploy user"  grep -q "^User=$PIXELSORT_USER$" "$T/units/pixelsort-update.service"
chk "the checkout path is filled in"              grep -q "ExecStart=$checkout/deploy/watcher/update.sh" "$T/units/pixelsort-update.service"
chk "the path unit watches check and requested"   bash -c "grep -q 'update-signal/check' '$T/units/pixelsort-update.path' && grep -q 'update-signal/requested' '$T/units/pixelsort-update.path'"
chk "the tick runs every 10 minutes"              grep -q 'OnUnitActiveSec=10min' "$T/units/pixelsort-tick.timer"
chk "no unit runs as root"                        bash -c "! grep -q '^User=root' '$T/units/'*"
chk "daemon-reload was called"                    grep -q 'daemon-reload' "$CALLS"
chk "the path and timer are enabled"              grep -q 'enable --now pixelsort-update.path pixelsort-tick.timer' "$CALLS"

# idempotent, and never overwrites .env
echo 'PIXELSORT_WORKER_SECRET=my-real-secret' >>"$checkout/.env"
sed -i 's/^PIXELSORT_PORT=.*/PIXELSORT_PORT=9999/' "$checkout/.env"
before="$(cat "$checkout/.env")"
unit_before="$(cat "$T/units/pixelsort-update.service")"
bash "$checkout/deploy/install.sh" >"$T/out2" 2>&1
chk "second run succeeds"                         test $? -eq 0
chk ".env is never overwritten"                   test "$(cat "$checkout/.env")" = "$before"
chk "the units are unchanged by a second run"     test "$(cat "$T/units/pixelsort-update.service")" = "$unit_before"
chk "the second run did not say it wrote .env"    bash -c "! grep -q 'wrote .env' '$T/out2'"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
