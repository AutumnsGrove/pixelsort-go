#!/usr/bin/env bash
# Renders docker-compose.yml with a sample .env and checks that the hardening options are really there. Needs
# `docker compose` (no daemon). Run from anywhere: make compose-test.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp "$root/docker-compose.yml" "$work/docker-compose.yml"
cp "$root/deploy/.env.example" "$work/.env"
sed -i 's/^PIXELSORT_IMAGE_DIGEST=.*/PIXELSORT_IMAGE_DIGEST=sha256:'"$(printf 'a%.0s' {1..64})"'/' "$work/.env"

json="$(cd "$work" && docker compose config --format json | tr -d ' \n')" # compact, so patterns do not depend on layout

fail=0
check() { # check <description> <jq-free grep pattern>
  if grep -Eq "$2" <<<"$json"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

check "image is pinned by digest"            '"image":"ghcr.io/autumnsgrove/pixelsort@sha256:a{64}"'
check "root filesystem is read-only"          '"read_only":true'
check "all capabilities dropped"              '"cap_drop":\["ALL"\]'
check "no-new-privileges"                     'no-new-privileges:true'
check "tmpfs on /tmp"                         '"tmpfs":\["/tmp"\]'
check "restarts always"                       '"restart":"always"'
check "runs as the deploy user, not 65532"    '"user":"1000:1000"'
check "published on loopback only"            '"host_ip":"127.0.0.1"'
check "signal folder is mounted"              'update-signal'

# a missing digest must stop compose, not silently run :latest
if (cd "$work" && sed -i '/^PIXELSORT_IMAGE_DIGEST=/d' .env && docker compose config >/dev/null 2>&1); then
  echo "FAIL a missing digest was accepted"; fail=1
else
  echo "ok   a missing digest is refused"
fi

exit "$fail"
