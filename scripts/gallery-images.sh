#!/usr/bin/env bash
# gallery-images.sh rebuilds the pictures in docs/images: the before/after pair is sorted by the real engine,
# and the screen shots are converted from the e2e run's `web/test-results/*.png`.
#
#   make e2e                     # produce the screen shots first
#   scripts/gallery-images.sh    # then write docs/images
#
# Needs Go, sips (macOS) and, optionally, cwebp. Nothing here runs in CI; the pictures are checked in.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/docs/images"
shots="$root/web/test-results"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

command -v sips >/dev/null || {
	echo "gallery-images: needs sips (macOS) to resize and convert the pictures" >&2
	exit 1
}

mkdir -p "$out"

# A JPEG at most `width` pixels wide and never upscaled, so the README stays light.
jpeg() {
	local src=$1 dst=$2 width=$3 quality=${4:-80} have
	have=$(sips -g pixelWidth "$src" | awk '/pixelWidth/ {print $2}')
	if ((have > width)); then
		sips --resampleWidth "$width" -s format jpeg -s formatOptions "$quality" "$src" --out "$dst" >/dev/null
	else
		sips -s format jpeg -s formatOptions "$quality" "$src" --out "$dst" >/dev/null
	fi
}

# The before/after pair: the study photo on its own, and the engine sorting it along 35 degrees.
recipe="$tmp/recipe.json"
printf '%s\n' '{"angle":35,"mode":"random","length":180,"randomness":10,"key":"luma","algo":"oddeven"}' >"$recipe"

(cd "$root" && go run ./cmd/pixelsort-go render \
	--in web/static/samples/forest.jpg --recipe "$recipe" --out "$tmp/sorted.png")

jpeg "$root/web/static/samples/forest.jpg" "$out/before.jpg" 1100 70
jpeg "$tmp/sorted.png" "$out/after.jpg" 1100 70

# The screen shots. Each entry is "test-results name:output name".
while IFS=: read -r src dst; do
	if [[ ! -f "$shots/$src.png" ]]; then
		echo "gallery-images: missing $shots/$src.png (run make e2e)" >&2
		continue
	fi
	jpeg "$shots/$src.png" "$out/$dst.jpg" 1280
done <<'SHOTS'
tour:studio
scrub:scrubbing
shape-library:shapes
regions:hexagons
region-cards:region-rules
pro-rules:cellular
brush-paint:protect-brush
brush-snap:protect-shape
mask-handles:mask-handles
share-dialog:share-link
share-albums:archive
phone-studio:phone-studio
phone-shapes:phone-shapes
phone-protect:phone-protect
brush-phone:phone-brush
SHOTS

ls -1 "$out"
