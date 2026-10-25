#!/usr/bin/env bash
set -euo pipefail

app="${1:?usage: scripts/release/notarize-app.sh <path/to/Codevo Whisper.app>}"
[ -d "$app" ] || { echo "missing $app" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive="$work/$(basename "$app" .app).zip"

ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
"$(dirname "$0")/notary-submit.sh" "$archive"
xcrun stapler staple "$app"
xcrun stapler validate "$app"
