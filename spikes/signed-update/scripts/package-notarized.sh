#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: scripts/package-notarized.sh <version> <arm64|x64>}"
arch="${2:?usage: scripts/package-notarized.sh <version> <arm64|x64>}"

sub="mac"
[ "$arch" = "arm64" ] && sub="mac-arm64"
out="release/${version}-${arch}"
app="${out}/${sub}/Codevo Whisper Spike.app"
dmg="${out}/codevo-whisper-spike-${version}-${arch}-mac.dmg"

[ -d "$app" ] || { echo "missing $app"; exit 1; }

codesign --verify --deep --strict "$app"
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute -vv "$app"

pnpm exec electron-builder --mac dmg zip "--${arch}" --prepackaged "$app" --publish never \
  -c.extraMetadata.version="$version" -c.mac.notarize=false -c.directories.output="$out"

scripts/notarize-dmg.sh "$dmg"
spctl --assess --type open --context context:primary-signature -vv "$dmg"
