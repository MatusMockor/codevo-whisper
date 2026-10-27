#!/usr/bin/env bash
set -euo pipefail

[ "$#" -gt 0 ] || { echo "usage: scripts/release/notarize-dmg.sh <file.dmg> [...]" >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"

for dmg in "$@"; do
  "$here/notary-wait.sh" "$("$here/notary-submit.sh" "$dmg")"
  "$here/retry.sh" stapler xcrun stapler staple "$dmg"
  "$here/retry.sh" stapler xcrun stapler validate "$dmg"
done
