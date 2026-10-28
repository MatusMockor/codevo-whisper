#!/usr/bin/env bash
set -euo pipefail

app="${1:?usage: scripts/release/verify-binaries.sh <path/to/Codevo Whisper.app> <arm64|x64>}"
arch="${2:?usage: scripts/release/verify-binaries.sh <path/to/Codevo Whisper.app> <arm64|x64>}"
max_minos="${MAX_MINOS:-13.0}"
bin="$app/Contents/Resources/bin/$arch"

case "$arch" in
  arm64) slice="arm64" ;;
  x64) slice="x86_64" ;;
  *) echo "unsupported arch: $arch" >&2; exit 1 ;;
esac

newer_than_max() {
  [ "$(printf '%s\n%s\n' "$1" "$max_minos" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)" != "$max_minos" ]
}

check_binary() {
  local file="$1" name minos_list minos
  name="$(basename "$file")"
  lipo "$file" -verify_arch "$slice" 2>/dev/null || { echo "$name: no $slice slice" >&2; return 1; }
  minos_list="$(vtool -show-build "$file" | awk '$1 == "minos" { print $2 }')"
  [ -n "$minos_list" ] || { echo "$name: no minos in the build version" >&2; return 1; }
  for minos in $minos_list; do
    if newer_than_max "$minos"; then
      echo "$name: minos $minos > $max_minos" >&2
      return 1
    fi
  done
  echo "ok $name $slice minos $minos_list"
}

failed=0
for required in codevo-input-helper transcribe-cli cw-stt-worker; do
  [ -f "$bin/$required" ] || { echo "$required: missing in $bin" >&2; failed=1; }
done

for file in "$bin"/*; do
  [ -f "$file" ] || continue
  check_binary "$file" || failed=1
done

exit "$failed"
