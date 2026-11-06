#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${FAKE_PW_ARGS_FILE:-}" ]]; then
  printf '%s\n' "$@" > "$FAKE_PW_ARGS_FILE"
fi
case "${FAKE_PW_MODE:-stream}" in
  stream)
    head -c 6400 /dev/zero
    exec sleep 30
    ;;
  exit)
    exit 2
    ;;
esac
