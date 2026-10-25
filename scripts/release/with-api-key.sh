#!/usr/bin/env bash
set -euo pipefail

[ "$#" -gt 0 ] || { echo "usage: scripts/release/with-api-key.sh <command> [args...]" >&2; exit 2; }
: "${APPLE_API_KEY_CONTENT:?APPLE_API_KEY_CONTENT must hold the .p8 key}"

umask 077
key_dir="$(mktemp -d)"
trap 'rm -rf "$key_dir"' EXIT
printf '%s\n' "$APPLE_API_KEY_CONTENT" >"$key_dir/AuthKey.p8"
unset APPLE_API_KEY_CONTENT

APPLE_API_KEY="$key_dir/AuthKey.p8" "$@"
