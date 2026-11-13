# CODWHI-43 original macOS validation

These are historical baseline results. The subsequent fixes and current verification are recorded in the [resolution report](codwhi-43-resolution.md).

2026-11-13. Base `8e8b7f3` after fast-forwarding `main`. Local branch `fix/codwhi-43-macos-validation`. macOS 26.3 (25D125), Apple Silicon, Swift 6.2.3, Node 24.17.0, pnpm 10.34.5, Electron 45.0.0.

**Release acceptance is not green.** Both helper architectures compile without warnings, but full-app tests found two release blockers, filed as [#53](https://github.com/MatusMockor/codevo-whisper/issues/53) and [#54](https://github.com/MatusMockor/codevo-whisper/issues/54). Do not close the release gate on the basis of the standalone helper results.

## Scope and method

The checks ran on a real logged-in macOS desktop with the actual Swift helper and native AppKit fields. CGEvent supplied native keyboard and mouse input. Full-app checks used the real helper, Electron overlay, pairing, remote dictation pipeline, and insertion service. Audio and transcription came from test fixtures, and a local HTTP fixture inspected the actual polish request. No live AI provider or real microphone recording was needed.

These are scripted native desktop checks, not a claim of human hands-on sign-off. macOS 14 itself and Intel runtime execution were not tested; runtime testing used macOS 26.3/arm64. The x64 helper was cross-compiled only. No signed release package was built or installed.

The helper reports Accessibility, Input Monitoring, and event posting available, both standalone and when launched by Electron. System Settings also showed Codevo Whisper enabled in Accessibility. No permission settings were changed. An initial missing-permissions UI diagnosis was incorrect: the old E2E launcher made Electron resolve its helper relative to `out/main`, resulting in ENOENT.

## Acceptance results

| Check | Result |
|---|---|
| arm64 and x64 helper builds | Pass, Swift 6 with warnings treated as errors, deployment target macOS 13 |
| Native raw JSON/nested shortcut arguments | Pass |
| Esc while recording | Pass in the full app; no transcript inserted; subsequent native typing reaches the target |
| Esc while transcribing | Pass in the full app, with a delayed transcription response; subsequent native typing reaches the target |
| Esc only while armed | Pass in the standalone event tap: intercepted while armed, delivered to the fixture after disarming |
| Native overlay × click | Cancels, but subsequent typing fails to reach the target; **fail**, [#53](https://github.com/MatusMockor/codevo-whisper/issues/53), [details](codwhi-43/overlay-focus.md) |
| Target chip click / Ctrl+Shift+L | Both lock the target with a non-conflicting dictation hotkey |
| Finish after switching target windows | Full app blocks insertion after native refocus reports success; **fail**, [#54](https://github.com/MatusMockor/codevo-whisper/issues/54), [details](codwhi-43/locked-delivery.md) |
| Standalone original field/caret insertion and same-app window return | Pass when insertion is allowed to settle before returning focus; insufficient proof for the full app |
| Removed target safety | Pass standalone and in the full app: no text inserted into the removed field or the other field |
| Readable context around the caret | Pass: actual local polish request contains `before` and `after` from the native field |
| Context never edits the existing field | Pass: both fields unchanged while the polish HTTP response is held; only the transcript is inserted after responding |
| Secure context | Pass standalone: `readable:false`, reason `protected`, no before/after fields, secure field unchanged |

The window-ID safety guard remains unchanged. An attempted relaxation exposed wrong-field typing in the native full-app test and was reverted. Refocus readiness and posted-input completion need investigation before any change to that guard.

## Retained fixes

- `RecordingAudio.swift`: use `Unmanaged<CFString>?` and `takeRetainedValue()` for CoreAudio name/UID results, matching the installed SDK headers' caller-release ownership contract. The original full build warned about passing a managed CFString as an unsafe raw pointer.
- `build.sh`: warnings now fail helper builds.
- `native-json-arguments.test.ts`: compile all helper sources with warnings as errors on macOS; recognize both success lines from the existing Swift fixture, including nested session-shortcut arguments. The original assertion failed on this Mac before the fix.
- `e2e/launch-app.ts`: launch the desktop package directory, preserving the app root/version and native helper path. Launching the compiled main JS directly incorrectly used `out/main` as the app path.
- Add opt-in native acceptance checks and a disposable AppKit target. Add delayed-STT support to the existing local test gateway for deterministic transcription cancellation.

No changes to target-lock delivery behavior or overlay behavior remain in this patch.

## Reproduce

Use Node 24 as required by `.nvmrc`, then:

```sh
pnpm install --frozen-lockfile
native/macos-helper/build.sh arm64
native/macos-helper/build.sh x64
swiftc -swift-version 6 -warnings-as-errors native/macos-helper/test/acceptance/main.swift -o /tmp/codwhi-43-fixture
python3 native/macos-helper/test/acceptance/run.py native/macos-helper/build/arm64/codevo-input-helper /tmp/codwhi-43-fixture
pnpm --filter @codevo-whisper/desktop build
CW_MAC_NATIVE_ACCEPTANCE=1 pnpm --dir apps/desktop exec playwright test macos-native.spec.ts
```

Run desktop checks sequentially, leaving the desktop available for their focus changes. They type only into disposable fixture fields. The E2E file skips unless explicitly opted in on macOS. It retains failing assertions for the filed defects.

Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` separately from desktop acceptance. Lint and typecheck pass. A focused helper/insertion/polish/shortcut run passed 163 tests. The isolated full unit run has six failures in unchanged tests, tracked in [#55](https://github.com/MatusMockor/codevo-whisper/issues/55), with names and analysis in [unit-suite.md](codwhi-43/unit-suite.md). A concurrent run also hit the live-frontmost integration assertion while the bundle-less fixture was foreground; do not use concurrent desktop runs as independent verification.

Before integration, the exact CI unit invocation, `pnpm exec vitest run --retry=1`, was also run on this Mac. It retained the same six failures; retries do not fix their platform/host assumptions. This does not reproduce CI's Linux environment. The pre-commit dependency audit reported nine existing advisories (three high, four moderate, two low); all three high findings are CPU-exhaustion issues in `scripts > js-yaml`, patched in js-yaml 4.3.2. This patch changes no dependencies or lockfile.

The final E2E run (`macos-native.spec.ts overlay.spec.ts launch.spec.ts`) has **22 passed, 5 skipped, 3 failed**. Its only failures are the native overlay-click focus check and both locked-delivery variants, corresponding to #53 and #54. The five skips are existing Linux-only overlay cases (also selected by the filename pattern). All seven new native cases ran: four passed and three failed. Renderer-only overlay checks pass, demonstrating why those checks alone missed the real-mouse focus problem.

## Evidence

Retained build/test logs and the original locked-delivery trace are under [codwhi-43/](codwhi-43/). The trace shows the original production safety check blocking the window-ID mismatch. It does not contain the unsafe experimental behavior.

Helper SHA-256:

```text
arm64 3c291bba20e5a832ecea49e91c301c1096a99828608e77d962b73a9d2100579d
x64   d2d8afc03be586c282f6d8279ec56ddb47e29e2a6047947a9234b680feac866f
```

The initial review agent could not start because its configured model was unsupported. A subsequent independent pre-merge review confirmed the CF ownership contract and found no production correctness/security blocker in the retained diff. Local review also confirmed that the temporary delivery/focus experiments were removed. This validation patch is being integrated into `main` at the owner's request; it does not resolve the filed runtime defects or authorize a release. No release or ticket-Done transition was performed.
