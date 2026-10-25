#!/usr/bin/env bash
set -euo pipefail

: "${APPLE_API_KEY_CONTENT:?APPLE_API_KEY_CONTENT must hold the .p8 key}"
: "${RUNNER_TEMP:?RUNNER_TEMP must be set}"
: "${GITHUB_ENV:?GITHUB_ENV must be set}"

key="$RUNNER_TEMP/AuthKey.p8"
umask 077
printf '%s\n' "$APPLE_API_KEY_CONTENT" >"$key"
echo "APPLE_API_KEY=$key" >>"$GITHUB_ENV"
