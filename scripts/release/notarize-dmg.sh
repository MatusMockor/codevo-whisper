#!/usr/bin/env bash
set -euo pipefail

[ "$#" -gt 0 ] || { echo "usage: scripts/release/notarize-dmg.sh <file.dmg> [...]" >&2; exit 2; }

for dmg in "$@"; do
  "$(dirname "$0")/notary-submit.sh" "$dmg"
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
done
