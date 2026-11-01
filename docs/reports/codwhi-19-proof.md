# CODWHI-19 QR pairing scanner proof

Implementation base: local CODWHI-16 `b4bd568abef9316ad87b58d163e229c5b7ac39e8`. Delivery branch: `feat/codwhi-19-mobile-pairing-qr`. Final commit is attached to the task's `proof/qr-scanner` Agent doc. Task remains In progress for the parent's combined independent review; no push, PR, merge or physical-phone install.

## Behavior and scope

`App.tsx` adds Scan QR immediately below secure token input using the existing dark/mint Action. Shared `PairingScanner` owns idle/scanning/result/error, validates native input with the authoritative protocol `parsePairingToken`, and fills the token field. Both scanned and typed input are limited to 16,384 UTF-16 units; native adapters apply the same bridge ceiling. Scanning cannot connect, approve or write the vault. Pair server/Replace pairing, fingerprint comparison and server operator approval remain explicit. Invalid QR, cancellation and scanner failure keep the previous input and protected pairing. Microphone acquisition now enters the existing recorder busy state before requesting permission, so scanning is disabled during that request too.

The Android Activity owns a QR-only, rear-camera JourneyApps capture view. It releases capture before returning, on cancel/Back and on pause/background. A permission phase prevents a permission dialog from being mistaken for an acquired-camera interruption. The bridge allows only one pending native scan. No frames, token logs or captured image files are produced. The camera Activity has FLAG_SECURE. Settings and paste provide recovery; cancellation is quiet.

The iOS adapter is real AVFoundation code, registered in the Xcode target, with NSCameraUsageDescription, rear camera, QR metadata filtering, serialized session start/stop, single completion, cancellation/background handling and a permission recovery path. It is **not compiled or run**: this Linux host has no Apple SDK/runtime. It needs macOS/Xcode and iPhone/iPad validation before an iOS usability claim.

No keyboard Service/View/Coordinator or fixture files changed. The existing Android gateway acceptance test now explicitly selects VaultTest, preserving its single-test assertion while scanner instrumentation is run separately with camera fixtures. The parent should retain this one-line selection when combining with CODWHI-18.

## Dependency choice

Pinned Android dependencies: `com.journeyapps:zxing-android-embedded:4.3.0` and `com.google.zxing:core:3.5.4` (Apache-2.0). The embedded widget owns capture, focus and QR decoding; app code owns its lifecycle and result. No custom QR decoder or camera framework was added. The embedded release is older; this maintenance cost is explicit, with the decoder pinned separately.

[Google Code Scanner](https://developers.google.com/ml-kit/vision/barcode-scanning/code-scanner) avoids app camera permission but needs an unbundled Play services module and exposes no application cancellation operation alongside startScan. Bundled ZXing removes that first-use/module dependency and gives the app direct capture teardown. [VisionCamera](https://visioncamera.margelo.com/docs/barcode-scanner) is established and shared, but currently recommends a separate package for one-shot native scans; its broader camera stack is unnecessary here. [JourneyApps](https://github.com/journeyapps/zxing-android-embedded) and [Apple AVFoundation](https://developer.apple.com/documentation/avfoundation/avcapturemetadataoutput) are the native integration sources. Context7 was absent from the live catalog and its bounded direct lookup was unavailable; official docs/source were used.

## Verification

- Red first: the initial shared scanner acceptance failed because the module did not exist; implement → green. Clearing feedback was added with another failing public test first. Home/reopen exposed an onStop lifecycle race; the regression failed before capture cancellation moved to onPause.
- Shared scanner: 13 tests pass (valid cw1, malformed/non-Codevo/scheme/size, cancel, late result, duplicate/busy, permission/unavailable, feedback reset).
- `buildq pnpm lint` and `buildq pnpm typecheck`: pass.
- `buildq pnpm test`: 176 files passed, 4 skipped; 1,540 tests passed, 25 skipped. Existing mobile-client tests still prove operator rejection/server-key mismatch preserves the previous protected pairing.
- `:app:assembleVerification :app:testVerificationUnitTest :app:assembleVerificationAndroidTest`: pass with six Gradle workers. Five JVM native tests pass. APK contains arm64-v8a and x86_64, bundled Hermes, and the existing app identity/development signature.
- Four focused UiAutomator camera tests run individually on disposable API 36 `emulator-5582`: valid fixture QR with a seeded prior protected pairing, non-Codevo QR preserving manual input, Cancel/Back/Home with normal task reopen, permission denial/settings/paste. Each checks released camera clients. Logs and nonsecret screenshots are in `docs/reports/codwhi-19/`.
- `:app:lintVerification` fails with one MissingPermission error at `PcmCapture.kt:19` and 19 warnings. A clean `git archive` of the exact base, frozen dependencies, and the same command reproduce that error and 19 warnings. The final report has no scanner findings. Audio code was left unchanged. This gate is reported, not suppressed.
- Impeccable detector returned `[]`; Android phone portrait captures inspected. No tablet/landscape runtime proof. iOS permission plist parses and scanner source is wired into its build phase; no Apple build/runtime proof.

The APK was tested only on the separate emulator. The Redmi Note 9 Pro, its pairing data, and the existing 8787/8001 server/reference worktree were untouched. The full keyboard/gateway Android acceptance harness was not run by this scanner worker; parent owns combined acceptance on ports 18787/18788. No camera, microphone, taps, screenshots, data clearing or install was performed on the physical phone.

## Repeat camera acceptance

Use a disposable emulator only, with an explicit serial. The fixture endpoint is `.invalid`, keys are fixed synthetic bytes, and there is no corresponding server. These PNGs contain no live credentials. Do not substitute a real pairing QR in screenshots or committed test artifacts.

Copy `camera-fixture-blank.png` to `/tmp/codwhi19-camera.png` and boot the disposable AVD with `-camera-back imagefile:/tmp/codwhi19-camera.png -port 5582 -cores 4 -memory 3072`. The emulator camera reloads the image on capture open. The [official emulator command documentation](https://developer.android.com/studio/run/emulator-commandline) describes imagefile camera input. Install both verification APKs with `adb -s emulator-5582 install -r ...`.

For each method, copy the indicated fixture to `/tmp/codwhi19-camera.png`, then run:

```sh
adb -s emulator-5582 shell am instrument -w \
  -e class 'com.codevo.PairingScannerTest#METHOD' \
  com.codevo.mobile.test/androidx.test.runner.AndroidJUnitRunner
```

Methods and inputs:

- `cancellationReleasesCameraAndPreservesPairing`: blank PNG.
- `rejectsOtherQrWithoutChangingEnteredTokenOrPairing`: invalid PNG.
- `scansCameraFixtureWithoutPairingAutomatically`: valid PNG. Seeds and restores a synthetic prior vault entry; requires no real server.
- `permissionDenialOffersSettingsAndPaste`: first revoke CAMERA and clear its `user-set user-fixed` permission flags with `adb -s emulator-5582 shell pm ...`; this resets only emulator permission-test state, not app data. The test denies the normal system prompt.

Physical acceptance remains for parent/user: after review, install the combined APK with install-r (same identity/signature), point the phone at the actual terminal QR, verify the filled secure field, then explicitly pair/compare fingerprints/approve. No clearing of phone data.

## Android artifact

APK: `/home/matcer/.t3/worktrees/codevo-whisper/t3-ad944fc6/apps/mobile/android/app/build/outputs/apk/verification/app-verification.apk`.

SHA-256: `552f3b5dbc799291b18312c9e5b4b2aba7aaf9d6ea9d1e9618cc4e5063b8ffef`.

Package: `com.codevo.mobile`. Development signing certificate SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. App identity and signing key are unchanged; parent can install-r the combined reviewed build without clearing phone pairing.
