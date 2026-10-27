#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/release/verify-shipped.sh <arm64|x64> <version>}"
version="${2:?usage: scripts/release/verify-shipped.sh <arm64|x64> <version>}"
here="$(cd "$(dirname "$0")" && pwd)"
config="$(cd "$here/../../apps/desktop" && pwd)/electron-builder.yml"
source "$here/mac-app-path.sh"
dist="$(mac_release_dir dist "$arch")"
zip="$dist/codevo-whisper-$version-$arch-mac.zip"
dmg="$dist/codevo-whisper-$version-$arch-mac.dmg"
require_notarization="${REQUIRE_NOTARIZATION:-1}"

work="$(mktemp -d)"
mount_point="$work/dmg"
cleanup() {
  if [ -d "$mount_point/Codevo Whisper.app" ]; then
    hdiutil detach "$mount_point" -quiet || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

verify_app() {
  local app="$1"
  [ -d "$app" ] || { echo "missing $app" >&2; exit 1; }
  "$here/verify-signature.sh" "$app" "$arch"
  "$here/verify-binaries.sh" "$app" "$arch"
  node "$here/verify-fuses.ts" "$app" "$config"
  if [ "$require_notarization" = "1" ]; then
    "$here/retry.sh" stapler xcrun stapler validate "$app"
  fi
}

ditto -x -k "$zip" "$work/zip"
verify_app "$work/zip/Codevo Whisper.app"

mkdir -p "$mount_point"
hdiutil attach "$dmg" -nobrowse -noautoopen -readonly -mountpoint "$mount_point" -quiet
verify_app "$mount_point/Codevo Whisper.app"

if [ "$require_notarization" = "1" ]; then
  "$here/verify-notarization.sh" "$work/zip/Codevo Whisper.app" "$dmg"
fi
echo "shipped $arch artifacts verified"
