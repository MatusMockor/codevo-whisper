#!/usr/bin/env bash
set -euo pipefail

app="${1:?usage: scripts/release/notarize-app.sh <path/to/Codevo Whisper.app>}"
[ -d "$app" ] || { echo "missing $app" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
ditto -c -k --sequesterRsrc --keepParent "$app" "$work/app.zip"
"$here/notary-wait.sh" "$("$here/notary-submit.sh" "$work/app.zip")"
"$here/retry.sh" stapler xcrun stapler staple "$app"
"$here/retry.sh" stapler xcrun stapler validate "$app"
