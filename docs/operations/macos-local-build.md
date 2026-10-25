# Signed local macOS build

Phase 1, Task 12. Builds a Developer ID signed `Codevo Whisper.app` for the owner's Mac and installs it to `~/Applications`. No DMG, no notarization (that is the release pipeline, see `docs/operations/release.md`).

## Prerequisites

- Xcode command line tools (`swiftc`, `codesign`, `iconutil`), `cmake` and `ninja` (`brew install cmake ninja`).
- Node from `.nvmrc`, pnpm from `packageManager`, `pnpm install` done.
- The identity `Developer ID Application: codevo s.r.o. (U574W69TH6)` in the login keychain (`security find-identity -v -p codesigning`). The first signing run can show a keychain prompt asking to allow `codesign` to use the key; choose "Always Allow".

## Build and install

```bash
scripts/build-mac-local.sh arm64
```

Steps, in order:

1. `scripts/release/build-native.sh arm64` builds the Swift input helper (`native/macos-helper/build.sh`) and transcribe-cli (`native/transcribe/build.sh`, pinned transcribe.cpp commit, Metal) and stages both in `apps/desktop/resources/bin/arm64/`.
2. `scripts/release/sign-native.sh arm64` signs both with hardened runtime, a secure timestamp and the identifiers `app.codevo.whisper.input-helper` and `app.codevo.whisper.transcribe-cli`.
3. `pnpm --filter @codevo-whisper/desktop build` (electron-vite bundle in `apps/desktop/out/`).
4. `electron-builder --mac dir --arm64 --publish never` with `apps/desktop/electron-builder.yml`: flips the Electron fuses, copies `model-catalog.json` and `bin/arm64/*` into `Contents/Resources/` (the paths `resolveModelCatalog`, `resolveTranscribeBinary` and `resolveHelperBinary` use when packaged), signs the app with the entitlements in `apps/desktop/build/entitlements.mac.plist` and skips the already signed binaries in `Contents/Resources/bin/` (`mac.signIgnore`), so their identifiers survive.
5. `scripts/release/verify-signature.sh` (deep strict verify, identifier, team, hardened runtime and timestamp of the app and both binaries) and `scripts/release/verify-fuses.ts` (fuse wire against `electronFuses` in `electron-builder.yml`).
6. Copies the app to `~/Applications/Codevo Whisper.app` with `ditto` and verifies it again. The script refuses to run while the installed app is running.

The script must run with Codevo Whisper quit. `x64` works the same way (`scripts/build-mac-local.sh x64`, app built under `apps/desktop/release/mac/`).

## Launch

```bash
env -u ELECTRON_RUN_AS_NODE open "$HOME/Applications/Codevo Whisper.app"
```

Shells started by Claude Code or VS Code export `ELECTRON_RUN_AS_NODE=1`. With the `runAsNode` fuse off the app ignores it and starts normally, but `env -u` keeps launches from terminals independent of the fuse state.

## Manual verification

```bash
codesign --verify --deep --strict --verbose=2 "$HOME/Applications/Codevo Whisper.app"
pnpm --dir apps/desktop exec electron-fuses read --app "$HOME/Applications/Codevo Whisper.app"
ELECTRON_RUN_AS_NODE=1 open -g -W "$HOME/Applications/Codevo Whisper.app"
```

The last command must start the app (tray icon, input helper process) instead of exiting after a second as plain Node; quit it from the tray to let `open -W` return.

## App icon

`apps/desktop/build/icon.icns` is generated from the codevo mark (geometry of the `logo` symbol in `docs/design/mockup.html`: navy tile, cyan and slate arcs, cyan dot) by

```bash
node scripts/icon/generate-icon.ts
```

The script rasterizes every iconset size directly (4x4 supersampling, tile at 824/1024 of the canvas like the macOS icon grid) and packs them with `iconutil`.

## Owner test checklist

Run from `~/Applications` with `env -u ELECTRON_RUN_AS_NODE open`. Record each result (OK / problem with details) in Results below.

1. Onboarding appears on the first start.
2. Permission prompts name `Codevo Whisper` (not Electron, not `codevo-input-helper`): Microphone, Accessibility, Input Monitoring. System Settings lists `Codevo Whisper` under each.
3. Hotkey recording: record right Control on the owner's keyboard; the recorder shows it and rejects a non-modifier key.
4. Model download: the recommended model (Parakeet Ultra Q8_0 on Apple Silicon) downloads only after the click, shows progress, can be paused and resumed, ends ready.
5. Dictation inserts the text into T3 Code, Notes, Slack, VS Code, Terminal and Chrome (hold mode and toggle mode).
6. Finder (no text field focused): text is only copied, overlay shows "Skopírované - vlož cez ⌘V".
7. Ctrl+Cmd+V pastes the last transcript into the focused app.
8. Microphone switch from the tray and from Nastavenia; take the AirPods out between two dictations: recording still works with the default device and the overlay says so.
9. Settings persist after quitting and starting again (hotkey, mode, language, microphone, model, insertion, overlay).
10. Launch at login: enable, log out and in, the app starts in the tray.
11. First-word cut: right after launching the app, press the hotkey and start speaking immediately ("Jedna dva tri štyri"). The first word must be in the transcript. Repeat for a second (warm) recording. Measured microphone start latency is about 455 ms on the first recording and 170 ms afterwards; if the first word is lost, note it and whether "Rýchlejší štart" helps.
12. Overlay stale frame: finish a dictation so the overlay shows "Vložené", then start the next dictation as soon as the overlay hides. The overlay must open directly in the recording state, never flashing the previous "Vložené" or "Spracúvam" frame. Repeat after an error state (for example dictation without a model) and after a copy-only result.

## Results

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Onboarding | | |
| 2 | Permission prompts name Codevo Whisper | | |
| 3 | Hotkey recording | | |
| 4 | Model download | | |
| 5 | Dictation into apps | | |
| 6 | Finder copy-only | | |
| 7 | Ctrl+Cmd+V | | |
| 8 | Microphone switch and AirPods fallback | | |
| 9 | Settings persistence | | |
| 10 | Launch at login | | |
| 11 | First-word cut | | |
| 12 | Overlay stale frame | | |
