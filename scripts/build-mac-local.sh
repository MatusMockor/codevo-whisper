#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/build-mac-local.sh <arm64|x64>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
identity="${CODESIGN_IDENTITY:-Developer ID Application: codevo s.r.o. (U574W69TH6)}"
source "$root/scripts/release/mac-app-path.sh"
built_app="$(mac_app_path "$root/apps/desktop/release" "$arch")"
desktop="$root/apps/desktop"
installed_app="$HOME/Applications/Codevo Whisper.app"

if ! security find-identity -v -p codesigning | grep -qF "\"$identity\""; then
  echo "signing identity not found in the keychain: $identity" >&2
  exit 1
fi

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
"$root/scripts/release/verify-binaries.sh" "$built_app" "$arch"
node "$root/scripts/release/verify-fuses.ts" "$built_app" "$desktop/electron-builder.yml"

mkdir -p "$HOME/Applications"
staging="$(mktemp -d "$HOME/Applications/.codevo-whisper-install.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
ditto "$built_app" "$staging/Codevo Whisper.app"
"$root/scripts/release/verify-signature.sh" "$staging/Codevo Whisper.app" "$arch"

previous="$staging/previous.app"
if [ -d "$installed_app" ]; then
  mv "$installed_app" "$previous"
fi
mv "$staging/Codevo Whisper.app" "$installed_app"
echo "installed $installed_app"
