#!/usr/bin/env bash
set -euo pipefail

file="${1:?usage: scripts/release/notary-submit.sh <file.zip|file.dmg>}"
: "${APPLE_API_KEY:?APPLE_API_KEY must be the path to the .p8 key}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID must be set}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER must be set}"

submission="$(xcrun notarytool submit "$file" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --no-wait --output-format json | plutil -extract id raw -o - -)"
echo "notary submission $submission for $(basename "$file")"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "- notary submission \`$submission\` for \`$(basename "$file")\`" >>"$GITHUB_STEP_SUMMARY"
fi

"$(dirname "$0")/notary-wait.sh" "$submission"
