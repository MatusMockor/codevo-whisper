CODWHI-43 validation of CODWHI-41 (#50), base 8e8b7f3, macOS 26.3 (25D125), arm64, Swift 6.2.3, Electron 45.0.0.

1. Open two native text windows in one app, with the caret inside text in the first.
2. Start dictation and lock its target via the chip or Ctrl+Shift+L. Use a non-conflicting dictation hotkey (Right Option in the fixture).
3. Focus the second window, then finish dictation.

Expected: insert in the original field/caret, then return focus to the second window.

Observed: the full app blocks delivery as a changed window; the first field remains unchanged. Both chip and shortcut paths reproduce.

The native trace shows `target-refocus` returning `moved`, followed by `check-delivery` with the capture ID returning `legacy` (the captured AX element passes `holdsFocus`). Immediately afterwards `frontmost` reports the correct app PID but the second window ID. `InsertionService` correctly blocks this mismatch and returns focus.

Do not remove the window-ID guard. A temporary local experiment retaining PID/bundle and per-command capture checks allowed direct typing into the second field when `target-return` immediately followed `type-text`. That experiment and its expectations were removed. Window readiness and posted-input completion need investigation; no root-cause fix is claimed.

Standalone helper checks with a pause between `type-text` and `target-return` pass. They do not prove the full app's immediate command sequence.

The opt-in reproduction is `apps/desktop/e2e/macos-native.spec.ts` with disposable AppKit fields. Run after building helper and Electron bundle:

```sh
CW_MAC_NATIVE_ACCEPTANCE=1 pnpm --dir apps/desktop exec playwright test macos-native.spec.ts --grep 'target lock'
```

This acceptance item blocks macOS release sign-off.
