# CODWHI-43 resolution

2026-11-14, macOS 26.3/arm64, Swift 6.2.3, Node 24.17.0. Follow-up to the [original validation](codwhi-43-proof.md), implementing fixes for issues #53, #54 and #55 on base `1690792`.

## Overlay cancellation (#53)

The real mouse click activated Electron. The previous frontmost-app check could run before that activation settled, and a normal `NSRunningApplication.activate` request from the helper could report success without returning keyboard ownership.

`OverlayFocus.swift` records the foreground application in the mouse event tap before native activation. It consumes that click snapshot only when Electron is still frontmost, checks for intervening clicks/app switches, and uses Accessibility's `AXFrontmost` activation to return keyboard focus. It does not restore the earlier dictation target when the user has switched to another app, and does not redirect an intentionally focused Electron settings window. No activation observer, native addon, or new dependency is used.

Cancellation aborts synchronously. Physical overlay hiding and the renderer's hidden state wait for focus handoff completion, so disappearance is a valid completion signal for subsequent typing.

## Locked delivery (#54)

There were three readiness failures: Accessibility's focused element could disagree with its window; WindowServer's window list could lag the AX change; and `CGEventPost` returned before all characters reached the editor. Cross-application transfers also needed Accessibility activation instead of relying on cooperative activation alone.

Native refocus now waits for the captured element, its focused window, and captured window ID to agree. Locked direct typing waits for the editor's UTF-16 caret advancement before permitting return focus. An unconfirmed delivery disables automatic focus return. All existing app identity, per-posting capture, secure-input, clipboard and removed-target guards remain in force.

Locked direct typing fails closed before posting when an editor has no readable AX caret (`caret-unavailable`). The existing typing-failure fallback preserves the transcript instead of falsely reporting that the field disappeared. Invalid/overflowing AX ranges are rejected. Unlocked direct typing is unchanged.

Regressions cover the original caret in the same app, chip and shortcut locking, default paste, transfer into a different application, actual keyboard input after return, removed-field safety, and Unicode delivery with immediate focus return.

## macOS test isolation (#55)

The three Codex tests now redirect fixed system install paths into temporary fixtures while executing the production discovery logic. New assertions verify both fixed fallback paths and PATH priority. The actual installed Codex CLI is not invoked by missing-binary tests.

Shortcut collision and rearming tests use explicit macOS, Linux X11, and Wayland keycode/platform cases. No production discovery/collision behavior or assertion was weakened, and no new skip was added to hide a failure.

The final validation also exposed an in-flight server capability request outliving shutdown: cancelling the polling interval did not settle its initial HTTP request. A deterministic regression first failed for that missing guarantee. Polling stop now returns a promise, and server shutdown settles that work even when another cleanup fails. The pairing/capability tests pass without the previously observed unhandled Node/Undici `setTypeOfService EINVAL` teardown error. A focused independent review found no blocker in this cleanup change.

## Dependency audit

All js-yaml copies are updated to 4.3.2; fast-xml-parser is updated to 5.12.0 with is-unsafe 2.0.3. Audit findings drop from nine to three: **zero high, two moderate, one low**. No overrides or advisory ignores were added.

Remaining findings are tracked in [#57](https://github.com/MatusMockor/codevo-whisper/issues/57): minimatch fixes require major-version changes in ESLint/@electron/universal, and deepmerge has no published patched version. This is not a claim of a completely clean dependency audit.

## Verification

Logs are retained under [codwhi-43-resolution/](codwhi-43-resolution/). Desktop tests use the actual helper and native keyboard/mouse input into disposable AppKit windows. Audio/transcription and the polish endpoint remain local fixtures. Run native UI checks sequentially and leave the desktop available for focus changes.

- arm64 and x64 Swift helper builds: warnings treated as errors, macOS deployment target 13.
- Standalone helper: original field/caret, Unicode acknowledgement before immediate return, secure context, no context edits, removed target and shortcut arm/disarm checks.
- Full-app native cases include actual typing after overlay disappearance, a newer external app, deliberately focused Electron settings, cross-app insertion/return, and default paste.
- Repository lint/typecheck and the exact CI unit invocation (`pnpm exec vitest run --retry=1`) are checked separately from native UI runs.
- Independent correctness/security review found no merge blocker. Its missing-caret error-classification and default-paste coverage notes were addressed.

The expanded E2E run has **29 passed, five existing Linux-only skips, zero failures**. All eleven native macOS cases ran. Standalone helper checks also pass, including non-BMP/combining Unicode and immediate return focus. Lint and typecheck pass; `pnpm audit --audit-level=high` exits successfully with the three lower-severity findings tracked above.

The final exact CI unit invocation on this Mac completes with **2,676 passed, nine existing skips, zero failures and zero unhandled errors** across 267 passing test files (two existing file skips). The existing CancellationToken listener warning remains visible; no warning/error suppression was added. The deterministic shutdown regression and focused capability/pairing run also pass (17 tests).

Built helper SHA-256:

```text
arm64 ef771552137951d27a0ffb5410ac2190d6997f0b6e66120bc400e0f6698544a0
x64   5efd9ff6ad12d1152ccbd23b727cc12a03f565036c5f67a2b8c433245730e4bc
```

Runtime testing uses macOS 26.3/arm64. x64 is cross-compiled only; macOS 14 itself, signed release packaging, and human hands-on release sign-off are not claimed.
