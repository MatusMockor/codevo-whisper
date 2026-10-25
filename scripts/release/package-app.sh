#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/release/package-app.sh <arm64|x64> <version>}"
version="${2:?usage: scripts/release/package-app.sh <arm64|x64> <version>}"
here="$(cd "$(dirname "$0")" && pwd)"
desktop="$(cd "$here/../../apps/desktop" && pwd)"
source "$here/mac-app-path.sh"
output="$(mac_release_dir stage "$arch")"

rm -rf "$output"
(cd "$desktop" && env -u ELECTRON_RUN_AS_NODE pnpm exec electron-builder --mac zip "--$arch" --publish never \
  -c.extraMetadata.version="$version" -c.directories.output="$output")

app="$(mac_app_path "$output" "$arch")"
[ -f "$app/Contents/Resources/app-update.yml" ] || { echo "$app has no app-update.yml" >&2; exit 1; }
"$here/verify-signature.sh" "$app" "$arch"
"$here/verify-binaries.sh" "$app" "$arch"
node "$here/verify-fuses.ts" "$app" "$desktop/electron-builder.yml"
echo "$app"
