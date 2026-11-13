CODWHI-43 validation of CODWHI-32 (#48), base 8e8b7f3, macOS 26.3 (25D125), arm64, Swift 6.2.3, Electron 45.0.0.

1. Focus an editable field at a known caret and start dictation.
2. Click the overlay × using an actual macOS mouse event.
3. After it disappears, type without clicking the target again.

Expected: cancellation preserves keyboard focus and typing reaches the original caret.

Observed: cancellation succeeds and inserts no transcript, but the target app's key window becomes nil and subsequent native typing does not reach its field. Its PID may still be frontmost. Renderer-only clicks and Electron focus flags miss this.

Both Accessibility and Input Monitoring are granted. Native Esc cancellation works while recording and transcribing. Preventing the renderer's mousedown default did not fix the problem; that experiment was removed. No root cause or fix is claimed.

The opt-in reproduction is `apps/desktop/e2e/macos-native.spec.ts`, using disposable AppKit fields under `native/macos-helper/test/acceptance/`. Run after building the helper and Electron bundle:

```sh
CW_MAC_NATIVE_ACCEPTANCE=1 pnpm --dir apps/desktop exec playwright test macos-native.spec.ts --grep 'during click'
```

This acceptance item blocks macOS release sign-off.
