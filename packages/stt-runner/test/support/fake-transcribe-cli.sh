#!/usr/bin/env bash
set -euo pipefail

output=""
args=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    *) shift ;;
  esac
done
wav="${args[${#args[@]}-1]}"

if [[ -n "${FAKE_CLI_ARGS_FILE:-}" ]]; then
  printf '%s\n' "${args[@]}" >> "$FAKE_CLI_ARGS_FILE"
  printf -- '--\n' >> "$FAKE_CLI_ARGS_FILE"
fi

case "${FAKE_CLI_MODE:-text}" in
  text)
    printf '  %s \n' "${FAKE_CLI_TEXT:-ahoj svet}" > "$output"
    ;;
  echo-chunk)
    first_sample="$(od -An -t d2 -j 44 -N 2 "$wav" | tr -d ' ')"
    data_bytes="$(od -An -t u4 -j 40 -N 4 "$wav" | tr -d ' ')"
    if [[ "$first_sample" -lt 0 ]]; then
      : > "$output"
      exit 0
    fi
    printf ' %s:%s \n' "$first_sample" "$data_bytes" > "$output"
    ;;
  oversize)
    head -c 16001 /dev/zero | tr '\0' 'a' > "$output"
    ;;
  fail)
    echo "model load failed" >&2
    exit 3
    ;;
  hang)
    if [[ -n "${FAKE_CLI_PID_FILE:-}" ]]; then
      echo "$$" > "$FAKE_CLI_PID_FILE"
    fi
    exec sleep 30
    ;;
esac
