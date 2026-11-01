# CODWHI-16 implementation proof

Verified in `/home/matcer/.t3/worktrees/codevo-whisper/t3-16bdb667`, based on main `038622318211e167065c0866d0d02a78c4867394`. The task's Agent proof doc records the final implementation commit. Independent gpt-6.1-sol review remains with the parent. The task is not Done.

## Android artifacts

The installable evaluation APK is `apps/mobile/android/app/build/outputs/apk/verification/app-verification.apk`. Its SHA-256 is `f2c1285f17e7abd84eeb1f51de175928adf922654196c325168341022362dde5`. It is 32161902 bytes, signed with the development key, and not debuggable. `apksigner verify` passed. Architectures are arm64-v8a and x86_64. Min SDK is 24; target is 36.

The unsigned distribution candidate is `apps/mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk`. Its SHA-256 is `dab846fe736470245bb1b20b7d18c0afce08f365afec6789bfb477eba3fce658`. It requires owner signing. Release resource inspection confirmed `cleartextTrafficPermitted=false`; the release APK has no verification host exceptions.

Both APKs contain 1363808-byte Hermes bytecode with magic `c61fbc03c103191f`. No Metro process was used. Builds ran through buildq with six Gradle/Metro workers. Native code uses the React Native new architecture's legacy-module interop.

## Executed checks

- `buildq pnpm lint` passed.
- `buildq pnpm typecheck` passed across the repository, including mobile, desktop, server and dev client.
- `buildq pnpm test` passed with 1527 tests passed and 25 skipped, across 175 passing test files and 4 skipped files. The suite emitted a CancellationToken MaxListenersExceededWarning without test failures; its source was not diagnosed in this task.
- Gradle `:app:assembleRelease :app:assembleVerification :app:testVerificationUnitTest :app:assembleVerificationAndroidTest :fixture:assembleDebug :fixture:assembleDebugAndroidTest` passed. Editor lease unit tests passed 3/3. Native socket tests passed 2/2.
- `buildq pnpm --filter @codevo-whisper/mobile exec vitest run --config android.acceptance.config.ts` passed. This runs both native vault instrumentation and the separate-app keyboard fixture against a live gateway. The final artifact outer test completed in 70.25s. The first fix-round run also passed in 70.96s. Gradle emits the pinned RN template's deprecated AGP DSL warnings.
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
- A separate protocol peer uses the real protocol's Noise handshake and transport to exercise Hermes pairing rejection, preservation of the old pairing, successful replacement, flow pause/resume with zero audio frames sent during the pause, STT error without late insertion, a Unicode final with a leading BOM, and malformed UTF-8 rejection without late insertion.
- Vault instrumentation verifies encrypted no-backup storage, successful round-trip, oversized replacement preserving the previous value, and rejection of modified ciphertext.
- AudioService reports no active Codevo recording at the terminal error. Its recording history includes corresponding native capture start/stop events.

The protocol/client tests also cover canonical pairing tokens without Buffer/URL.canParse/TextDecoder, malformed UTF8, the original leading-BOM behavior, ordered transcript finals, unsolicited done, send failure, bounded queues, flow, cancellation, rejected replacement, changed server keys and revoked devices. Existing Noise/vector/rekey tests remained green.

[Browser insertion](codwhi-16/browser-success.png) and [server error without late insertion](codwhi-16/error-safety.png) are screenshots of synthetic fixture text, not user recordings.

Raw logs and local artifacts remain available to the parent under `/tmp/codwhi-comment-build.log`, `/tmp/codwhi-companion-acceptance.log`, `/tmp/codwhi-final-lint.log`, `/tmp/codwhi-final-typecheck.log`, `/tmp/codwhi-final-tests.log`, `/tmp/codwhi-artifact-proof.json`, `/tmp/codwhi-release-network.txt`, and `/tmp/codwhi-audio-release.txt`.

## Remaining validation

Actual acoustic speech quality, physical-device Gboard/T3 input fields, manufacturer-specific lifecycle behavior, and Android 17 local-network enforcement at target 37 are not verified. The API 36 emulator's real AudioRecord pipeline was exercised with emulated input; this does not prove a physical microphone.

The iOS companion adapter and Xcode target are implemented but were not compiled, signed or run. macOS/Xcode and iPhone validation are required. No iOS keyboard extension ships. Release Android requires a valid wss endpoint and production signing. No PR was opened and no merge was attempted. The parent must perform its independent gpt-6.1-sol review before shipping.


## P1 fix-round evidence

The fix is limited to strict protocol decoding and bounded mobile transport. The server protocol, Noise implementation, editor lease, and secure randomness remain unchanged. Parent-owned independent delta review is still pending.

The UTF-8 regression failed before the fix with `AssertionError: 84 8c: expected [Function] to throw an error`. Both public decoders now reject malformed continuation leads, overlong sequences, truncation, surrogate encodings, and values above U+10FFFF. Unicode boundaries, literal percent text, and one leading BOM round-trip without TextDecoder. The decoder uses standard-native `decodeURIComponent` over percent-encoded bytes, not a custom UTF-8 parser. Stablelib's protocol dependency was removed. Mobile keeps its encoder for the TextEncoder shim.

The transport regression failed before the fix with `AssertionError: expected 419200 to be less than or equal to 64000`. React Native 0.88.1 leaves bufferedAmount undefined. The shared adapter now reserves at most 64000 ciphertext bytes and permits one native send at a time. Android releases that reservation only after actual OkHttp queueSize reaches zero. iOS uses URLSession send completion. Native sends reject oversized or overlapping frames and have a ten-second deadline. Closing cancels pending work and suppresses stale callbacks.

The real OkHttp stall test blocks MockWebServer's reader, fills the actual socket queue, observes a pending send while queueSize is nonzero, then observes deadline failure. A separate test rejects a 64001-byte native frame before sending. MockWebServer 4.9.2 is test-only and matches the installed RN OkHttp version. Its source decrements queueSize after writeMessageFrame returns. The kernel's fixed socket buffers are outside that count.

The public runRecording regression uses the real Noise handshake and a stalled native completion contract. It observes terminal and stopCapture calls. Delayed encrypted final/done frames and delayed send completion cannot call the editor's complete method. This bridge test and the real native stall test are separate proofs. A physically stalled phone uplink with AudioRecord was not tested.

The final artifact run passed in 70.25s. Packaged Hermes acceptance exercises the revised native socket for pairing, cold headless IME, capture, ordered flow, final insertion, cancellation, editor changes, and server errors. It also accepts a leading BOM with `Č`, an emoji, and literal percent text. The next run sends an encrypted final containing `84 8c`, followed by done. Hermes rejects the malformed message, the editor retains its prior text, and dumpsys audio reports no active Codevo recorder.

The final verification APK is 32161902 bytes. The unsigned release APK is 32153586 bytes. Both contain 1363808-byte Hermes bytecode, target arm64-v8a and x86_64, and are not debuggable. The verification signature passed apksigner. Release resources still prohibit cleartext traffic. The verification-only localhost exceptions remain confined to that variant.

Fix-round logs and artifacts are `/tmp/codwhi-16-fix-utf8-red.log`, `/tmp/codwhi-16-fix-utf8-green.log`, `/tmp/codwhi-16-fix-transport-red.log`, `/tmp/codwhi-16-fix-transport-green.log`, `/tmp/codwhi-16-fix-native-tests.log`, `/tmp/codwhi-16-fix-final-build.log`, `/tmp/codwhi-16-fix-lint.log`, `/tmp/codwhi-16-fix-typecheck.log`, `/tmp/codwhi-16-fix-tests.log`, `/tmp/codwhi-16-fix-android-acceptance.log`, `/tmp/codwhi-16-fix-final-android-acceptance.log`, `/tmp/codwhi-16-fix-artifact-proof.json`, `/tmp/codwhi-16-fix-apksigner.log`, and `/tmp/codwhi-16-fix-release-network.txt`.

Apple's native adapter remains uncompiled and unrun on Linux. Its TLS-only URLSession implementation and asynchronous cleanup were statically inspected. macOS/Xcode and device checks remain required. Physical microphone quality, manufacturer-specific lifecycles, and physical-device T3/Gboard fields remain unverified.
