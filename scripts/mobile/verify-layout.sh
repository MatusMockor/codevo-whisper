#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo/scripts/mobile/android-env.sh"
[[ "${ANDROID_SERIAL:-}" == emulator-* ]] || { printf 'Layout matrix changes emulator settings. Set an explicit emulator ANDROID_SERIAL.\n' >&2; exit 1; }
output="${1:-$repo/test-results/codwhi-20/layout-matrix}"
mkdir -p "$output"
a() { adb -s "$ANDROID_SERIAL" "$@"; }
font_before="$(a shell settings get system font_scale | tr -d '\r')"
rotation_before="$(a shell settings get system user_rotation | tr -d '\r')"
accelerometer_before="$(a shell settings get system accelerometer_rotation | tr -d '\r')"
nav_before="$(a shell settings get secure navigation_mode | tr -d '\r')"
restore_setting() {
  if [[ "$2" == null ]]; then a shell settings delete system "$1"
  else a shell settings put system "$1" "$2"; fi
}
restore() {
  a shell wm user-rotation free
  restore_setting font_scale "$font_before"
  restore_setting user_rotation "$rotation_before"
  restore_setting accelerometer_rotation "$accelerometer_before"
  if [[ "$nav_before" == 2 ]]; then a shell cmd overlay enable --user 0 com.android.internal.systemui.navbar.gestural
  else a shell cmd overlay enable --user 0 com.android.internal.systemui.navbar.threebutton; fi
}
trap restore EXIT
a shell settings put system accelerometer_rotation 0
[[ "$(a shell settings get secure default_input_method | tr -d '\r')" == com.codevo.mobile/com.codevo.VoiceInputService ]] || { printf 'Select Codevo on the emulator before layout acceptance.\n' >&2; exit 1; }
other_ime="$(a shell ime list -s | tr -d '\r' | rg -v '^com.codevo.mobile/com.codevo.VoiceInputService$' | sed -n '1p')"
[[ -n "$other_ime" ]] || { printf 'Keep a regular keyboard enabled on the emulator.\n' >&2; exit 1; }
a shell ime set "$other_ime" > "$output/preflight-switch.txt"
a shell ime set com.codevo.mobile/com.codevo.VoiceInputService >> "$output/preflight-switch.txt"
a shell am start -W -f 0x10008000 -n com.codevo.fixture/.EditorActivity > "$output/preflight-editor.txt"
for attempt in {1..25}; do
  a shell dumpsys input_method > "$output/preflight-ime.txt"
  if rg -q 'mInputShown=true' "$output/preflight-ime.txt"; then break; fi
  sleep 0.2
done
rg -q 'mInputShown=true' "$output/preflight-ime.txt" || { printf 'No connected visible IME for layout acceptance.\n' >&2; exit 1; }
for phase in geometry preview; do
  for navigation in 2 0; do
    if [[ "$navigation" == 2 ]]; then a shell cmd overlay enable --user 0 com.android.internal.systemui.navbar.gestural
    else a shell cmd overlay enable --user 0 com.android.internal.systemui.navbar.threebutton; fi
    for font in 1.0 1.3; do
      a shell settings put system font_scale "$font"
      for orientation in portrait landscape; do
        label="nav${navigation}-font${font}-${orientation}"
        if [[ "$phase" == geometry ]]; then
          a shell am instrument -w -e class com.codevo.fixture.GeometryTest -e configureEmulator true -e expectedFont "$font" -e expectedOrientation "$orientation" -e expectedNavigation "$navigation" -e expectedLanguage true com.codevo.fixture.test/androidx.test.runner.AndroidJUnitRunner > "$output/$label.txt"
          a logcat -d -s CodevoGeometry:I '*:S' > "$output/$label-geometry.txt"
          a pull /sdcard/Android/data/com.codevo.fixture/files "$output/$label-images" > "$output/$label-pull.txt" 2>&1
          rg -q 'OK \(3 tests\)' "$output/$label.txt" || { cat "$output/$label.txt"; exit 1; }
        else
          a shell am instrument -w -e class com.codevo.KeyboardPreviewTest -e configureEmulator true -e expectedOrientation "$orientation" com.codevo.mobile.test/androidx.test.runner.AndroidJUnitRunner > "$output/$label-phases.txt"
          rg -q 'OK \(1 test\)' "$output/$label-phases.txt" || { cat "$output/$label-phases.txt"; exit 1; }
          a pull /sdcard/Android/data/com.codevo.mobile/files "$output/$label-phase-images" > "$output/$label-phase-pull.txt" 2>&1
        fi
        printf '%s %s passed\n' "$label" "$phase"
      done
    done
  done
done
