#!/usr/bin/env bash
set -euo pipefail

submission="${1:?usage: scripts/release/notary-wait.sh <submission-id>}"
: "${APPLE_API_KEY:?APPLE_API_KEY must be the path to the .p8 key}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID must be set}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER must be set}"
timeout="${NOTARY_TIMEOUT:-150m}"
auth=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")

xcrun notarytool wait "$submission" "${auth[@]}" --timeout "$timeout" || true

info="$(xcrun notarytool info "$submission" "${auth[@]}" --output-format json)"
status="$(plutil -extract status raw -o - - <<<"$info")"

if [ "$status" = "Accepted" ]; then
  echo "notarization $submission accepted"
  exit 0
fi

if [ "$status" = "In Progress" ]; then
  echo "notarization $submission still In Progress after $timeout; re-run the failed job to resume waiting on the same submission" >&2
  exit 75
fi

echo "$info" >&2
xcrun notarytool log "$submission" "${auth[@]}" >&2 || true
echo "notarization $submission ended with status $status" >&2
exit 1
