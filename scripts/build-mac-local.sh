#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/build-mac-local.sh <arm64|x64>}"
case "$arch" in
  arm64) app_dir="mac-arm64" ;;
  x64) app_dir="mac" ;;
  *) echo "unsupported arch: $arch" >&2; exit 1 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
desktop="$root/apps/desktop"
built_app="$desktop/release/$app_dir/Codevo Whisper.app"
installed_app="$HOME/Applications/Codevo Whisper.app"

if pgrep -f "$installed_app/Contents/MacOS/" >/dev/null; then
  echo "quit Codevo Whisper before installing a new build" >&2
  exit 1
fi

"$root/scripts/release/build-native.sh" "$arch"
"$root/scripts/release/sign-native.sh" "$arch"

pnpm --dir "$root" --filter @codevo-whisper/desktop build
rm -rf "$built_app"
(cd "$desktop" && env -u ELECTRON_RUN_AS_NODE pnpm exec electron-builder --mac dir "--$arch" --publish never)

"$root/scripts/release/verify-signature.sh" "$built_app" "$arch"
node "$root/scripts/release/verify-fuses.ts" "$built_app" "$desktop/electron-builder.yml"

mkdir -p "$HOME/Applications"
rm -rf "$installed_app"
ditto "$built_app" "$installed_app"
"$root/scripts/release/verify-signature.sh" "$installed_app" "$arch"
echo "installed $installed_app"
