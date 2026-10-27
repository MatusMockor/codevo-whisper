#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/release/retry.sh <network|stapler|submit> <command> [args...]"
kind="${1:?$usage}"
shift
[ "$#" -gt 0 ] || { echo "$usage" >&2; exit 2; }

here="$(cd "$(dirname "$0")" && pwd)"
source "$here/apple-errors.sh"
transient="$APPLE_NETWORK_ERRORS"
definitive=''
case "$kind" in
  network) ;;
  stapler) transient="$STAPLER_TRANSIENT_ERRORS" ;;
  submit) definitive="$NOTARY_SUBMISSION_ID" ;;
  *) echo "$usage" >&2; exit 2 ;;
esac

attempts="${RETRY_ATTEMPTS:-6}"
delay="${RETRY_DELAY_SECONDS:-15}"
max_delay="${RETRY_MAX_DELAY_SECONDS:-120}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

label="$1 ${2:-} ${3:-}"

finish() {
  cat "$work/out"
  cat "$work/err" >&2
  exit "$1"
}

retryable() {
  if [ -n "$definitive" ] && grep -qE -- "$definitive" "$work/out" "$work/err"; then
    return 1
  fi
  grep -qE -- "$transient" "$work/out" "$work/err"
}

attempt=1
while true; do
  status=0
  "$@" >"$work/out" 2>"$work/err" || status=$?
  if [ "$status" -eq 0 ] || ! retryable; then
    finish "$status"
  fi
  if [ "$attempt" -ge "$attempts" ]; then
    echo "retry: $label still failing with a transient network error after $attempt attempts, giving up" >&2
    finish "$status"
  fi
  cat "$work/out" "$work/err" >&2
  echo "retry: $label failed with a transient network error (attempt $attempt/$attempts, exit $status), retrying in ${delay}s" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
  delay=$((delay * 2))
  if [ "$delay" -gt "$max_delay" ]; then
    delay="$max_delay"
  fi
done
