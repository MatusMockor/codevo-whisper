#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/release/package-distributables.sh <arm64|x64> <version>}"
version="${2:?usage: scripts/release/package-distributables.sh <arm64|x64> <version>}"
here="$(cd "$(dirname "$0")" && pwd)"
desktop="$(cd "$here/../../apps/desktop" && pwd)"
output="$desktop/release/dist/$arch"
source "$here/mac-app-path.sh"
app="$(mac_app_path "$desktop/release/stage/$arch" "$arch")"

[ -d "$app" ] || { echo "missing $app, run scripts/release/package-app.sh first" >&2; exit 1; }

rm -rf "$output"
(cd "$desktop" && env -u ELECTRON_RUN_AS_NODE pnpm exec electron-builder --mac dmg zip "--$arch" --prepackaged "$app" --publish never \
  -c.extraMetadata.version="$version" -c.directories.output="$output")

for file in "codevo-whisper-$version-$arch-mac.dmg" "codevo-whisper-$version-$arch-mac.zip" latest-mac.yml; do
  [ -f "$output/$file" ] || { echo "missing $output/$file" >&2; exit 1; }
done
codesign --verify --strict --verbose=2 "$output/codevo-whisper-$version-$arch-mac.dmg"
