# CODWHI-20 mobile keyboard evidence

The physical Redmi remains untouched by this worker. The parent owns independent review, safe fixture installation, physical acceptance, and the final app update. No physical install, data clearing, microphone, camera, screen capture, tap, rotation, or keyboard-setting change ran here. The user's existing GPU server was not used.

## Measurement premise and observed failure

The rejected premise was that the input child's unconstrained measured height equals the complete IME window height. `VoiceKeyboardView.onMeasure` discarded Android's height constraint and posted that height to `VoiceInputService`, which resized the whole window. Android 12 also reserves IME decor and navigation space within that window.

An API-31 emulator was created at 1080×2400, density 440, font 1.0, with gesture navigation. The original reference APK from `t3-ad944fc6` reproduces the physical screenshot's clipped lower row. Both native and browser bottom-editor tests fail with `Control clipped or too small: Rect(198, 2234 - 1036, 2268) target=132`. Only 34px of the 132px Record target is visible. The old window explicitly requests height 342px. Baseline files live in `test-results/codwhi-20/api31-baseline*`.

The implementation removes the posted content-height callback and `window.setLayout` assignment. Android owns wrapping, input-frame measurement, and host occlusion. An outer FrameLayout uses Android fitsSystemWindows; an inner LinearLayout owns content spacing. The child no longer changes its padding from an inset listener. A first-frame test exposed that the listener could squeeze a row before the wrapping window grew. The view requests insets when attached, the framework consumes them, and the input view reports its intrinsic content height. This matches Android 12 [KeyboardView measurement](https://github.com/aosp-mirror/platform_frameworks_base/blob/android12-release/core/java/android/inputmethodservice/KeyboardView.java#L606). The service leaves the whole window at framework WRAP_CONTENT. A native regression applies a 132px navigation inset after initial measurement. Without intrinsic measurement it fails with expected 550, actual 418; with intrinsic measurement it passes. The provisional 80dp height-cap test was replaced because it imposed an artificial parent constraint incompatible with a keyboard containing two 48dp rows. Real IME geometry is the acceptance seam. This follows Android's [InputMethodService contract](https://developer.android.com/reference/android/inputmethodservice/InputMethodService), including wrapping input views and computing content occlusion from the input frame.

The native fixture uses a bottom EditText in a traditional `ADJUST_RESIZE` host. The browser fixture uses a bottom contenteditable and measures the actual DOM selection range. Browser geometry runs first to establish an IME client before the native geometry test. Tests compare the editor, native caret, browser caret, and every available control against the host's actual IME top and navigation region. Three hide/show cycles exercise window updates. Accessibility input bounds permit one dp of platform rounding; actual caret bounds remain strict.

## Other behavior

The native keyboard uses desktop charcoal, amber, and ink tokens. Setup and Cancel are vector icons with descriptions, 48dp targets, ripple, and visible focus states. The switch-keyboard control remains available.

The existing PCM capture computes signed 16-bit RMS per captured frame. The same bounded delivery callback updates a maximum 26-level history. Rendering uses the desktop square-root scale with a minimum of 0.08 and maximum of 1. Every phase outside recording clears history. No second microphone session, new raw-audio storage, or timer animation was added.

Language is validated as auto, sk, en, or cs and stored in nonsecret native preferences. Each native attempt snapshots the language before runtime launch. Both companion and headless Hermes read that immutable attempt value before sending Noise `start`. Changes during a run are rejected, and the keyboard selector is disabled. An expanding choice row stays inside the IME hierarchy; an Android-12 floating popup was discarded after it exposed only Auto below the keyboard.

The shared app queries actual microphone permission and own-IME enabled/selected state. Mount, foreground, and permission completion refresh status and language. Completed steps are acknowledged. The setup instrumentation returns to the existing Activity with REORDER_TO_FRONT after granting microphone permission and changing the selected IME, proving foreground refresh rather than remounting. Paired users see the recorder first and can expand Pairing settings for QR, paste, replacement, and removal. iOS adapters expose compatible language and permission methods, with keyboard `notApplicable`; no Apple build or runtime result is claimed.

## Validation commands

All heavy work uses `buildq`, Gradle uses `--max-workers=6`, and every adb acceptance operation has an explicit emulator serial.

```sh
source scripts/mobile/android-env.sh
buildq apps/mobile/android/gradlew -p apps/mobile/android \
  :app:assembleVerification :app:assembleVerificationAndroidTest \
  :app:testVerificationUnitTest :app:lintVerification \
  :fixture:assembleDebug :fixture:assembleDebugAndroidTest \
  --no-daemon --max-workers=6
buildq pnpm --filter @codevo-whisper/mobile test
pnpm --filter @codevo-whisper/mobile typecheck
pnpm exec eslint apps/mobile/src apps/mobile/test apps/server/test/mobile-android.acceptance.ts
ANDROID_SERIAL=emulator-5580 buildq pnpm --filter @codevo-whisper/mobile exec vitest run --config android.acceptance.config.ts
ANDROID_SERIAL=emulator-5580 scripts/mobile/verify-layout.sh test-results/codwhi-20/final-matrix
```

`gateway-delivery.txt` passes the actual Hermes/gateway flow. The fake STT records `sk`, and the test exercises original-editor insertion, editor changes, cancel, hide, password fields, browser insertion, companion recording, pairing replacement, flow control, and malformed/server errors. Bridge tests also decrypt the real Noise start message and assert its language. Public native measurement, preference persistence, phase rendering, and setup-status tests are included.

The final API-36 matrix passes all eight combinations of gesture or three-button navigation, font 1.0 or 1.3, and portrait or landscape. It runs 24 geometry methods, including 48 native/browser hide/show geometry samples, and captures all six phases in each configuration, for 48 phase captures. Each case asserts the actual viewport, font, navigation mode, control bounds, editor, and caret. The latest API-31 run passes all three methods at the Redmi geometry. Native inset growth and persistent attempt language pass two instrumentation methods. Screenshot guards on the final safe fixture pass on API31 and API36. Six JVM and 26 JS tests pass. Mobile TypeScript and scoped ESLint pass. Android lint passes with zero errors; its warnings are retained in the build report.

The inset-growth test is red against the intermediate constrained implementation and green against the final intrinsic implementation. Original installed-APK clipping is independently reproduced against the reference APK. The final QR camera cancellation test opens Pairing settings, cancels with the button and Back, backgrounds the scanner, checks camera release, and preserves protected pairing. Full QR decode fixture cases from CODWHI-19 were not rerun.

Review evidence is committed under `docs/reports/codwhi-20/`. `baseline-red.txt`, `insets-red.txt`, `insets-green.txt`, `api31.txt`, `matrix.txt`, and `geometry.txt` hold the root-cause and geometry evidence. Before, native/browser after, ready, real captured-audio recording, synthetic waveform, finishing, error, landscape/font1.3, and completed setup PNGs are included. The synthetic waveform preview is explicitly labelled and does not open a microphone. The actual recording screenshot uses the existing captured PCM stream.

No dependencies were added. An API-31 SDK image and isolated AVD were used only for validation. iOS was not built or run on Linux. Independent review is pending with the parent; no cross-family verdict, merge readiness, physical pass, or task completion is claimed.

Additional focused checks use these exact classes:

```sh
ANDROID_SERIAL=emulator-5584 adb shell am instrument -w -e class com.codevo.KeyboardMeasurementTest,com.codevo.VoiceSettingsTest com.codevo.mobile.test/androidx.test.runner.AndroidJUnitRunner
ANDROID_SERIAL=emulator-5580 adb shell am instrument -w -e class com.codevo.fixture.SetupStatusTest com.codevo.fixture.test/androidx.test.runner.AndroidJUnitRunner
ANDROID_SERIAL=emulator-5580 adb shell am instrument -w -e class 'com.codevo.PairingScannerTest#cancellationReleasesCameraAndPreservesPairing' com.codevo.mobile.test/androidx.test.runner.AndroidJUnitRunner
```

## Parent-only physical layout run

Use only the dedicated inert fixture and its androidTest APK. Both require API 30 or later. No pairing token, recording permission, or server is needed. Installing either fixture APK is the parent's action. Keep the current Codevo app installed for the baseline; update the app only after independent review. Never run the emulator acceptance script on the phone. It intentionally clears emulator app data and rejects a physical serial.

The safe methods do not change orientation, navigation mode, font scale, permissions, IME selection, pairing, or language. They open only synthetic fixture editors, hide/show their keyboard, log geometry, and capture only their synthetic screen.

```sh
phone="${PHONE_SERIAL:?Set PHONE_SERIAL to the parent-selected test phone}"
adb -s "$phone" shell am instrument -w \
  -e class 'com.codevo.fixture.GeometryTest#nativeBottomComposer,com.codevo.fixture.GeometryTest#browserBottomComposer' \
  -e expectedFont 1.0 -e expectedOrientation portrait \
  com.codevo.fixture.test/androidx.test.runner.AndroidJUnitRunner
adb -s "$phone" logcat -d -s CodevoGeometry:I '*:S'
adb -s "$phone" pull /sdcard/Android/data/com.codevo.fixture/files /tmp/codwhi-20-phone-layout
```

Run the same methods before and after the reviewed app update. The optional expectedNavigation argument checks the platform settings value; the stock emulator uses 2 for gesture and 0 for three buttons. The phone command does not assume MIUI uses those stock values. Navigation-region geometry is always checked. The emulator matrix establishes a connected IME by switching to another enabled keyboard and back; the physical methods never change selection. Leave Codevo selected and establish a fixture editor session before running the layout methods. For the new APK, add `-e expectedLanguage true` to require the new selector. Require `OK (2 tests)` and inspect both synthetic screenshots plus the logged caret, IME, and control bounds. A missing IME is a failed precondition, never a fit pass. The first editor immediately after replacing a selected IME sometimes receives no connected Android IME session. The trace records mCurMethod=null and mEnabledSession=null, so this is not counted as a successful layout. Confirm physical behavior after the update; no phone proof is claimed here. Physical fixture tests require API 30 or later. The user's Redmi is API 31.


## Delivery artifacts

Paths are relative to this worktree, `/home/matcer/.t3/worktrees/codevo-whisper/t3-d806b355`.

- App `apps/mobile/android/app/build/outputs/apk/verification/app-verification.apk`. SHA-256 `748f69fa09117361f9c5abcd7cecfed29a46c9c8f3a8bdd301f226bb3a10498c`.
- Inert fixture `apps/mobile/android/fixture/build/outputs/apk/debug/fixture-debug.apk`. SHA-256 `6095b216f8e267601b3281923bbeaeea71a3f892c6df67bb269600a305aa868e`.
- Safe fixture tests `apps/mobile/android/fixture/build/outputs/apk/androidTest/debug/fixture-debug-androidTest.apk`. The final hash is in `docs/reports/codwhi-20/artifact-sha256.txt`.
- Development signing certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, unchanged from the installed base. Package identity remains `com.codevo.mobile`. The parent uses install-r after review, preserving pairing.

The two physical-safe methods capture only when the synthetic fixture owns focus and the device is unlocked. They refuse screenshots outside that fixture. The parent still needs to inspect and install the fixture/test APKs, collect old-app geometry, obtain a fresh independent sol review, install the reviewed app without clearing data, and rerun the same geometry methods. No worker action on the phone substitutes for those checks.
