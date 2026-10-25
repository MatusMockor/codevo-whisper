#!/usr/bin/env bash
set -euo pipefail

: "${APPLE_API_KEY:?APPLE_API_KEY must be set}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID must be set}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER must be set}"

for dmg in "$@"; do
  xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
done
