#!/usr/bin/env bash
set -euo pipefail

submission="${1:?usage: scripts/release/notary-wait.sh <submission-id>}"
: "${APPLE_API_KEY:?APPLE_API_KEY must be the path to the .p8 key}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID must be set}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER must be set}"
timeout="${NOTARY_TIMEOUT:-150m}"
delay="${RETRY_DELAY_SECONDS:-15}"
max_delay="${RETRY_MAX_DELAY_SECONDS:-120}"
here="$(cd "$(dirname "$0")" && pwd)"
auth=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
source "$here/apple-errors.sh"

duration_seconds() {
  local value="$1"
  if ! [[ "$value" =~ ^([0-9]+)([smh]?)$ ]]; then
    echo "NOTARY_TIMEOUT must be an integer with an optional s, m or h suffix, got: $value" >&2
    return 1
  fi
  case "${BASH_REMATCH[2]}" in
    h) echo $((10#${BASH_REMATCH[1]} * 3600)) ;;
    m) echo $((10#${BASH_REMATCH[1]} * 60)) ;;
    *) echo $((10#${BASH_REMATCH[1]})) ;;
  esac
}

budget="$(duration_seconds "$timeout")"
deadline=$(($(date +%s) + budget))
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

while true; do
  remaining=$((deadline - $(date +%s)))
  if [ "$remaining" -le 0 ]; then
    break
  fi
  status=0
  xcrun notarytool wait "$submission" "${auth[@]}" --timeout "${remaining}s" 2>&1 | tee "$work/wait" || status=$?
  if [ "$status" -eq 0 ] || ! grep -qE -- "$APPLE_NETWORK_ERRORS" "$work/wait"; then
    break
  fi
  remaining=$((deadline - $(date +%s)))
  if [ "$remaining" -le 0 ]; then
    break
  fi
  pause=$((delay < remaining ? delay : remaining))
  echo "notarytool wait for $submission lost the network (exit $status); waiting again in ${pause}s, ${remaining}s of $timeout left" >&2
  sleep "$pause"
  delay=$((delay * 2))
  if [ "$delay" -gt "$max_delay" ]; then
    delay="$max_delay"
  fi
done

info="$("$here/retry.sh" network xcrun notarytool info "$submission" "${auth[@]}" --output-format json)"
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
"$here/retry.sh" network xcrun notarytool log "$submission" "${auth[@]}" >&2 || true
echo "notarization $submission ended with status $status" >&2
exit 1
