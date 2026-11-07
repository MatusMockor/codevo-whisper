#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "login" ]]; then
  if [[ "${FAKE_CODEX_MODE:-answer}" == "login-hang" ]]; then
    sleep 30 &
    echo "$!" > "$FAKE_CODEX_DIR/pid"
    wait
  fi
  [[ "${FAKE_CODEX_MODE:-answer}" == "logged-out" || "${FAKE_CODEX_MODE:-answer}" == "hang-logged-out" ]] && { echo "Not logged in" >&2; exit 1; }
  echo "Logged in using ChatGPT" >&2
  exit 0
fi

output=""
workdir=""
args=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -C) workdir="$2"; shift 2 ;;
    *) shift ;;
  esac
done

printf '%s\n' "${args[@]}" > "$FAKE_CODEX_DIR/args"
ls -A "$workdir" > "$FAKE_CODEX_DIR/workdir-listing"
cat > "$FAKE_CODEX_DIR/stdin"

case "${FAKE_CODEX_MODE:-answer}" in
  answer) printf '%s\n' "${FAKE_CODEX_ANSWER:-Hotový text.}" > "$output" ;;
  no-output) ;;
  oversize) head -c 1048577 /dev/zero | tr '\0' 'a' > "$output" ;;
  logged-out)
    echo "ERROR: unexpected status 401 Unauthorized: Missing bearer or basic authentication in header" >&2
    exit 1
    ;;
  fail)
    echo "error: unexpected argument '--disable' found" >&2
    exit 2
    ;;
  hang | hang-logged-out)
    sleep 30 &
    echo "$!" > "$FAKE_CODEX_DIR/pid"
    wait
    ;;
esac
