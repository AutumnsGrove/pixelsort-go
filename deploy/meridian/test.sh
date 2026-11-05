#!/usr/bin/env bash
# Every Meridian snippet must parse: JSON with node, YAML with python3's yaml module when it is installed.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail=0
for f in "$here"/*.json.snippet; do
  if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$f"; then echo "ok   $(basename "$f") parses"; else echo "FAIL $(basename "$f")"; fail=1; fi
done
if python3 -c 'import yaml' 2>/dev/null; then
  if python3 -c 'import sys, yaml; yaml.safe_load(open(sys.argv[1]))' "$here/config-snippet.yaml"; then echo "ok   config-snippet.yaml parses"; else echo "FAIL config-snippet.yaml"; fail=1; fi
else
  echo "skip config-snippet.yaml: python3 yaml module not installed"
fi
node -e '
const t = JSON.parse(require("fs").readFileSync(process.argv[1] + "/targets.json.snippet", "utf8")).pixelsort;
const ok = t.kind === "compose" && t.service === "pixelsort" && t.criticality === "low" &&
  JSON.stringify(t.actions) === JSON.stringify(["start", "stop", "restart", "update"]) &&
  t.update.kind === "unit" && t.update.unit === "pixelsort-update.service";
process.exit(ok ? 0 : 1);' "$here" && echo "ok   the target has the agreed fields" || { echo "FAIL the target's fields"; fail=1; }
exit "$fail"
