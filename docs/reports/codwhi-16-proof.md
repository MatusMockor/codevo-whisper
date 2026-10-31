# CODWHI-16 implementation proof

Verified in `/home/matcer/.t3/worktrees/codevo-whisper/t3-16bdb667`, based on main `038622318211e167065c0866d0d02a78c4867394`. The task's Agent proof doc records the final implementation commit. Independent gpt-6.1-sol review remains with the parent. The task is not Done.

## Android artifacts

The installable evaluation APK is `apps/mobile/android/app/build/outputs/apk/verification/app-verification.apk`. Its SHA-256 is `d435e9e330b53d0e3a1566c6fd02f054e772a4380cd1a021018e60a1cc232fdc`. It is 32160302 bytes, signed with the development key, and not debuggable. `apksigner verify` passed. Architectures are arm64-v8a and x86_64. Min SDK is 24; target is 36.

The unsigned distribution candidate is `apps/mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk`. Its SHA-256 is `fe4ed0b348c892cc9bde3fdfae1ec86293481075b972513c33c7f761e207987c`. It requires owner signing. Release resource inspection confirmed `cleartextTrafficPermitted=false`; the release APK has no verification host exceptions.

Both APKs contain 1362208-byte Hermes bytecode with magic `c61fbc03c103191f`. No Metro process was used. Builds ran through buildq with six Gradle/Metro workers. Native code uses the React Native new architecture's legacy-module interop.

## Executed checks

- `buildq pnpm lint` passed.
- `buildq pnpm typecheck` passed across the repository, including mobile, desktop, server and dev client.
- `buildq pnpm test` passed with 1521 tests passed and 25 skipped, across 174 passing test files and 4 skipped files. The suite emitted a CancellationToken MaxListenersExceededWarning without test failures; its source was not diagnosed in this task.
- Gradle `:app:assembleRelease :app:assembleVerification :app:testVerificationUnitTest :app:assembleVerificationAndroidTest :fixture:assembleDebug :fixture:assembleDebugAndroidTest` passed. Editor lease unit tests passed 3/3.
- `buildq pnpm --filter @codevo-whisper/mobile exec vitest run --config android.acceptance.config.ts` passed. This runs both native vault instrumentation and the separate-app keyboard fixture against a live gateway. The final outer test completed in 62.82s. Gradle emits the pinned RN template's deprecated AGP DSL warnings.
- Shell syntax checks passed for all three `scripts/mobile` scripts. `git diff --check` passed. The native UI detector returned no findings. iOS plist/XML and adapter source references passed static inspection only.

## Runtime evidence

Host uses verified Temurin 17.0.21+9, Google command-line tools 16111833, SDK 37/build-tools 37.0.0, NDK 27.1.12297006, CMake 3.22.1, and the API 36 Google APIs x86_64 emulator. The emulator used KVM, four cores, 3GB RAM and no host audio input. No physical phone was connected.

The final Android fixture exercised:

- Pairing by the real gateway's server operator, encrypted session negotiation and deterministic STT completion.
- Force-stopped app process, then selection of Codevo IME from an independent editor app, with no Codevo Activity visible. Hermes starts from the APK.
- Denied microphone permission, clear failure with no insertion, permission grant, then AudioRecord PCM capture.
- Stop inserts the expected synthetic text exactly once. Delayed completion after an editor change leaves both fields correct.
- Cancel and hide prevent insertion. Password fields disable Record.
- The switch control reaches emulator Gboard. A WebView field receives text through the original InputConnection. The shared foreground recorder also captures, stops and displays the gateway transcript.
- A separate protocol peer uses the real protocol's Noise handshake and transport to exercise Hermes pairing rejection, preservation of the old pairing, successful replacement, flow pause/resume with zero audio frames sent during the pause, and STT error without late insertion.
- Vault instrumentation verifies encrypted no-backup storage, successful round-trip, oversized replacement preserving the previous value, and rejection of modified ciphertext.
- AudioService reports no active Codevo recording at the terminal error. Its recording history includes corresponding native capture start/stop events.

The protocol/client tests also cover canonical pairing tokens without Buffer/URL.canParse/TextDecoder, malformed UTF8, the original leading-BOM behavior, ordered transcript finals, unsolicited done, send failure, bounded queues, flow, cancellation, rejected replacement, changed server keys and revoked devices. Existing Noise/vector/rekey tests remained green.

[Browser insertion](codwhi-16/browser-success.png) and [server error without late insertion](codwhi-16/error-safety.png) are screenshots of synthetic fixture text, not user recordings.

Raw logs and local artifacts remain available to the parent under `/tmp/codwhi-comment-build.log`, `/tmp/codwhi-companion-acceptance.log`, `/tmp/codwhi-final-lint.log`, `/tmp/codwhi-final-typecheck.log`, `/tmp/codwhi-final-tests.log`, `/tmp/codwhi-artifact-proof.json`, `/tmp/codwhi-release-network.txt`, and `/tmp/codwhi-audio-release.txt`.

## Remaining validation

Actual acoustic speech quality, physical-device Gboard/T3 input fields, manufacturer-specific lifecycle behavior, and Android 17 local-network enforcement at target 37 are not verified. The API 36 emulator's real AudioRecord pipeline was exercised with emulated input; this does not prove a physical microphone.

The iOS companion adapter and Xcode target are implemented but were not compiled, signed or run. macOS/Xcode and iPhone validation are required. No iOS keyboard extension ships. Release Android requires a valid wss endpoint and production signing. No PR was opened and no merge was attempted. The parent must perform its independent gpt-6.1-sol review before shipping.
