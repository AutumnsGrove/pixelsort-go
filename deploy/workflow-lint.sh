#!/usr/bin/env bash
# Lints the GitHub Actions workflows with actionlint when it is installed.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if command -v actionlint >/dev/null 2>&1; then
  actionlint "$root"/.github/workflows/*.yml
  echo "actionlint: ok"
else
  echo "actionlint is not installed; skipping (https://github.com/rhysd/actionlint). The first real run is the test."
fi
