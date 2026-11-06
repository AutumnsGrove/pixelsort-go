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
if python3 -c 'import yaml' 2>/dev/null; then
  # The tile shows three vitals: the build, the disk, and how many pictures are in the Archive (GET /api/usage "runs").
  python3 - "$here/config-snippet.yaml" <<'PY' && echo "ok   the tile has the build, disk and archive vitals" || { echo "FAIL the tile's vitals"; fail=1; }
import sys, yaml
svc = yaml.safe_load(open(sys.argv[1]))["services"][0]
vitals = {v["label"]: v for v in svc["probes"]["vitals"]}
ok = list(vitals) == ["build", "disk", "archive"]
a = vitals.get("archive", {})
ok = ok and a.get("kind") == "json_field" and a.get("url") == "http://localhost:8895/api/usage" and a.get("path") == "runs"
sys.exit(0 if ok else 1)
PY
fi
node -e '
const t = JSON.parse(require("fs").readFileSync(process.argv[1] + "/targets.json.snippet", "utf8")).pixelsort;
const ok = t.kind === "compose" && t.service === "pixelsort" && t.criticality === "low" &&
  JSON.stringify(t.actions) === JSON.stringify(["start", "stop", "restart", "update"]) &&
  t.update.kind === "unit" && t.update.unit === "pixelsort-update.service";
process.exit(ok ? 0 : 1);' "$here" && echo "ok   the target has the agreed fields" || { echo "FAIL the target's fields"; fail=1; }
exit "$fail"
