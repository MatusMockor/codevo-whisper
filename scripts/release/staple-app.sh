#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/release/staple-app.sh <arm64|x64> <state-dir>}"
state="${2:?usage: scripts/release/staple-app.sh <arm64|x64> <state-dir>}"
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/mac-app-path.sh"
app="$(mac_app_path "$(mac_release_dir stage "$arch")" "$arch")"

"$here/notary-wait.sh" "$(node "$here/notary-state-cli.ts" submission "$state" app)"
xcrun stapler staple "$app"
xcrun stapler validate "$app"
