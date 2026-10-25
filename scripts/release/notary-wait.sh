#!/usr/bin/env bash
set -euo pipefail

submission="${1:?usage: scripts/release/notary-wait.sh <submission-id>}"
: "${APPLE_API_KEY:?APPLE_API_KEY must be the path to the .p8 key}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID must be set}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER must be set}"
timeout="${NOTARY_TIMEOUT:-150m}"
auth=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")

if ! xcrun notarytool wait "$submission" "${auth[@]}" --timeout "$timeout"; then
  echo "notarization $submission did not finish within $timeout, resume with: scripts/release/notary-wait.sh $submission" >&2
  exit 1
fi

status="$(xcrun notarytool info "$submission" "${auth[@]}" --output-format json | plutil -extract status raw -o - -)"
if [ "$status" != "Accepted" ]; then
  xcrun notarytool log "$submission" "${auth[@]}" >&2 || true
  echo "notarization $submission ended with status $status" >&2
  exit 1
fi
echo "notarization $submission accepted"
