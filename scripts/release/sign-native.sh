#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/release/sign-native.sh <arm64|x64>}"
identity="${CODESIGN_IDENTITY:-Developer ID Application: codevo s.r.o. (U574W69TH6)}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
bin="$root/apps/desktop/resources/bin/$arch"

sign() {
  local file="$1" identifier="$2"
  [ -f "$file" ] || { echo "missing $file" >&2; exit 1; }
  codesign --force --options runtime --timestamp --identifier "$identifier" --sign "$identity" "$file"
  codesign --verify --strict --verbose=2 "$file"
}

sign "$bin/codevo-input-helper" app.codevo.whisper.input-helper
sign "$bin/transcribe-cli" app.codevo.whisper.transcribe-cli
