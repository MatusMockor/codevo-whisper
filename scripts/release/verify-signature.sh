#!/usr/bin/env bash
set -euo pipefail

app="${1:?usage: scripts/release/verify-signature.sh <path/to/Codevo Whisper.app> <arm64|x64>}"
arch="${2:?usage: scripts/release/verify-signature.sh <path/to/Codevo Whisper.app> <arm64|x64>}"
team="U574W69TH6"

codesign --verify --deep --strict --verbose=2 "$app"

expect_signature() {
  local file="$1" identifier="$2" details
  details="$(codesign --display --verbose=4 "$file" 2>&1)"
  grep -q "^Identifier=$identifier$" <<<"$details" || { echo "$file: identifier is not $identifier" >&2; exit 1; }
  grep -q "^TeamIdentifier=$team$" <<<"$details" || { echo "$file: team is not $team" >&2; exit 1; }
  grep -q "flags=0x10000(runtime)" <<<"$details" || { echo "$file: hardened runtime is off" >&2; exit 1; }
  grep -q "^Timestamp=" <<<"$details" || { echo "$file: no secure timestamp" >&2; exit 1; }
  echo "ok $identifier"
}

expect_signature "$app" app.codevo.whisper
expect_signature "$app/Contents/Resources/bin/$arch/codevo-input-helper" app.codevo.whisper.input-helper
expect_signature "$app/Contents/Resources/bin/$arch/transcribe-cli" app.codevo.whisper.transcribe-cli
