#!/usr/bin/env bash
set -euo pipefail

app="${1:?usage: scripts/release/verify-notarization.sh <path/to/Codevo Whisper.app> <file.dmg>}"
dmg="${2:?usage: scripts/release/verify-notarization.sh <path/to/Codevo Whisper.app> <file.dmg>}"
here="$(cd "$(dirname "$0")" && pwd)"

assessment="$("$here/retry.sh" network spctl --assess --type execute -vv "$app" 2>&1)" || { echo "$assessment" >&2; echo "$app was rejected by spctl" >&2; exit 1; }
echo "$assessment"
grep -q "source=Notarized Developer ID" <<<"$assessment" || { echo "$app is not accepted as Notarized Developer ID" >&2; exit 1; }

"$here/retry.sh" stapler xcrun stapler validate "$app"
"$here/retry.sh" stapler xcrun stapler validate "$dmg"
"$here/retry.sh" network spctl --assess --type open --context context:primary-signature -vv "$dmg"
