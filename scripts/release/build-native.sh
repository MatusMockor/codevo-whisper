#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/release/build-native.sh <arm64|x64>}"
case "$arch" in
  arm64 | x64) ;;
  *) echo "unsupported arch: $arch" >&2; exit 1 ;;
esac

root="$(cd "$(dirname "$0")/../.." && pwd)"
dest="$root/apps/desktop/resources/bin/$arch"

"$root/native/macos-helper/build.sh" "$arch"
"$root/native/transcribe/build.sh" "$arch"

mkdir -p "$dest"
cp "$root/native/macos-helper/build/$arch/codevo-input-helper" "$dest/codevo-input-helper.tmp"
mv -f "$dest/codevo-input-helper.tmp" "$dest/codevo-input-helper"
echo "staged native binaries in $dest"
