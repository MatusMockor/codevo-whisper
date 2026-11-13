Full unit suite on macOS 26.3/arm64, Node 24.17.0, pnpm 10.34.5, after `pnpm install --frozen-lockfile`:

```text
Test Files  3 failed | 264 passed | 2 skipped (269)
Tests       6 failed | 2659 passed | 9 skipped (2674)
```

Command: `pnpm test`. The following failures are in unchanged code/tests outside the helper-build fix:

- `apps/desktop/test/codex-cli.test.ts`: `codexProvider > reports a missing binary as not found`; `findCodex > prefers codex on PATH and otherwise finds it in a user install directory`; `checkCodex > reports a logged-out CLI without sending a prompt, and a missing one as not found`. A real `/opt/homebrew/bin/codex` is discovered despite the tests' temporary PATH/HOME. Results are `codex-logged-out` or the installed path instead of `codex-not-found`/null. Isolate discovery from the host installation without removing valid production search paths.
- `apps/desktop/test/core-handlers.test.ts > writeSettings`: `refuses a dictation hotkey or an in-dictation shortcut that one key press fires together`; `saves a repaired in-dictation shortcut while the unchanged one still collides with a modifier-only dictation hotkey`. The inputs use Linux-tagged keycodes (`0x10000 + …`) while the handler defaults to the running macOS platform; promises resolve instead of rejecting. Make the platform fixture explicit and verify both platforms.
- `apps/desktop/test/session-coordinator.test.ts > SessionCoordinator > re-arms the in-dictation shortcuts when the dictation hotkey changes while a dictation is processing`. Expected actions omit `toggle-polish`, but it remains armed with the test's Linux keycode on macOS. Make the platform fixture explicit and verify intended collision behavior.

These failures are recorded for follow-up; the full suite is not green. No production shortcut/codex-discovery defect is inferred solely from these assertions. The run also emits the existing CancellationToken MaxListeners warning.
