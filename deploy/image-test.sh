#!/usr/bin/env bash
# Builds the image and checks what a deploy depends on: it serves /healthz with the isolation and security headers,
# serves the WASM with the right type, runs read-only and unprivileged, keeps its data across a restart, prints its
# version, builds for arm64, and is small. Needs a Docker daemon. Usage: deploy/image-test.sh [image-name]
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
image="${1:-pixelsort:test}"
version="${VERSION:-test.$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo dev)}"
name="pixelsort-image-test-$$"
data="$(mktemp -d)"
port="${PIXELSORT_TEST_PORT:-18895}"
fail=0

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$data"; }
trap cleanup EXIT

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

wait_healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

run() {
  docker run -d --name "$name" -p "127.0.0.1:$port:8895" -v "$data:/data" \
    --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp \
    --user "$(id -u):$(id -g)" "$image" >/dev/null
}

# PIXELSORT_BUILD_CA: a CA bundle to trust while building, for networks that re-sign TLS (a corporate or sandbox proxy).
secret=()
if [ -n "${PIXELSORT_BUILD_CA:-}" ]; then secret=(--secret "id=ca,src=$PIXELSORT_BUILD_CA"); fi

# PIXELSORT_BUILD_FLAGS: extra flags for docker build, e.g. --pull=false when the base images are already local.
read -ra extra <<<"${PIXELSORT_BUILD_FLAGS:-}"

docker build "${secret[@]}" "${extra[@]}" --build-arg "VERSION=$version" -t "$image" "$root"

run
if wait_healthy; then ok "serves /healthz read-only, unprivileged"; else bad "did not become healthy"; docker logs "$name" || true; exit 1; fi

headers="$(curl -fsSI "http://127.0.0.1:$port/")"
for h in "Cross-Origin-Opener-Policy: same-origin" "Cross-Origin-Embedder-Policy: require-corp" "Content-Security-Policy:" "X-Content-Type-Options: nosniff"; do
  if grep -qi "^$h" <<<"$headers"; then ok "header $h"; else bad "missing header $h"; fi
done
if curl -fsSI "http://127.0.0.1:$port/engine.wasm" | grep -qi '^content-type: application/wasm'; then ok "engine.wasm is application/wasm"; else bad "engine.wasm has the wrong type"; fi
if curl -fsS "http://127.0.0.1:$port/healthz" | grep -q "\"version\":\"$version\""; then ok "/healthz reports $version"; else bad "version mismatch in /healthz"; fi

# data survives a restart: the database file is created on first start and must still be there afterwards
[ -s "$data/pixelsort.db" ] && ok "database created in the volume" || bad "no database in the volume"
docker restart "$name" >/dev/null
if wait_healthy && [ -s "$data/pixelsort.db" ]; then ok "restart keeps the data"; else bad "restart lost the data or never came back"; fi
docker rm -f "$name" >/dev/null

# the entrypoint override prints the version (the image has no shell)
if [ "$(docker run --rm --entrypoint /app/pixelsort-go "$image" version)" = "$version" ]; then ok "version command prints $version"; else bad "version command"; fi

# size
bytes="$(docker image inspect "$image" --format '{{.Size}}')"
echo "image size: $((bytes / 1000000)) MB"
if [ "$bytes" -lt 40000000 ]; then ok "under 40 MB"; else bad "image is $((bytes / 1000000)) MB, over 40"; fi

# arm64 (QEMU emulation is fine); record in NOTES.md if buildx is missing
if [ -n "${PIXELSORT_SKIP_ARM64:-}" ]; then
  echo "skip arm64: PIXELSORT_SKIP_ARM64 is set"
elif docker buildx version >/dev/null 2>&1; then
  if docker buildx build "${secret[@]}" --platform linux/arm64 --build-arg "VERSION=$version" -t "$image-arm64" "$root" >/dev/null; then ok "builds for linux/arm64"; else bad "arm64 build failed"; fi
else
  echo "skip arm64: docker buildx is not available (note it in docs/dev/NOTES.md)"
fi

exit "$fail"
