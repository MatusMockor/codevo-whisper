#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/release/submit-app.sh <arm64|x64> <state-dir>}"
state="${2:?usage: scripts/release/submit-app.sh <arm64|x64> <state-dir>}"
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/mac-app-path.sh"
app="$(mac_app_path "$(mac_release_dir stage "$arch")" "$arch")"

[ -d "$app" ] || { echo "missing $app" >&2; exit 1; }
mkdir -p "$state"
rm -f "$state/app.zip" "$state/app.json" "$state/dmg.json"
rm -rf "$state/dist"
ditto -c -k --sequesterRsrc --keepParent "$app" "$state/app.zip"
submission="$("$here/notary-submit.sh" "$state/app.zip")"
node "$here/notary-state-cli.ts" record "$state" app "$submission" app.zip
