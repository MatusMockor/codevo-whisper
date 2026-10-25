#!/usr/bin/env bash
set -euo pipefail

app="${1:?usage: scripts/release/verify-notarization.sh <path/to/Codevo Whisper.app> <file.dmg>}"
dmg="${2:?usage: scripts/release/verify-notarization.sh <path/to/Codevo Whisper.app> <file.dmg>}"

assessment="$(spctl --assess --type execute -vv "$app" 2>&1)" || { echo "$assessment" >&2; echo "$app was rejected by spctl" >&2; exit 1; }
echo "$assessment"
grep -q "source=Notarized Developer ID" <<<"$assessment" || { echo "$app is not accepted as Notarized Developer ID" >&2; exit 1; }

xcrun stapler validate "$app"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature -vv "$dmg"
