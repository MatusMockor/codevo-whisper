#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/release/staple-dmg.sh <arm64|x64> <version> <state-dir>}"
version="${2:?usage: scripts/release/staple-dmg.sh <arm64|x64> <version> <state-dir>}"
state="${3:?usage: scripts/release/staple-dmg.sh <arm64|x64> <version> <state-dir>}"
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/mac-app-path.sh"
dmg="$(mac_release_dir dist "$arch")/codevo-whisper-$version-$arch-mac.dmg"

"$here/notary-wait.sh" "$(node "$here/notary-state-cli.ts" submission "$state" dmg)"
"$here/retry.sh" stapler xcrun stapler staple "$dmg"
"$here/retry.sh" stapler xcrun stapler validate "$dmg"
