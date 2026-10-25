#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/release/submit-dmg.sh <arm64|x64> <version> <state-dir>}"
version="${2:?usage: scripts/release/submit-dmg.sh <arm64|x64> <version> <state-dir>}"
state="${3:?usage: scripts/release/submit-dmg.sh <arm64|x64> <version> <state-dir>}"
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/mac-app-path.sh"
dist="$(mac_release_dir dist "$arch")"
dmg="codevo-whisper-$version-$arch-mac.dmg"

[ -f "$dist/$dmg" ] || { echo "missing $dist/$dmg" >&2; exit 1; }
rm -rf "$state/dist"
mkdir -p "$state/dist"
cp "$dist/"* "$state/dist/"
submission="$("$here/notary-submit.sh" "$state/dist/$dmg")"
files=()
for file in "$state/dist/"*; do
  files+=("dist/$(basename "$file")")
done
node "$here/notary-state-cli.ts" record "$state" dmg "$submission" "${files[@]}"
