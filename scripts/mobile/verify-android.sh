#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo/scripts/mobile/android-env.sh"
cd "$repo"
if [[ "${ANDROID_SERIAL:-}" != emulator-* ]]; then
  printf 'Set ANDROID_SERIAL to a disposable emulator. This verification clears app data.\n' >&2
  exit 1
fi
if ! adb -s "$ANDROID_SERIAL" get-state > /dev/null 2>&1; then
  printf 'Start an Android emulator or attach a test phone. This verification clears com.codevo.mobile data.\n' >&2
  exit 1
fi
buildq apps/mobile/android/gradlew -p apps/mobile/android :app:assembleVerification :app:testVerificationUnitTest :app:assembleVerificationAndroidTest :fixture:assembleDebug :fixture:assembleDebugAndroidTest --no-daemon --max-workers=6
buildq pnpm --filter @codevo-whisper/mobile exec vitest run --config android.acceptance.config.ts
