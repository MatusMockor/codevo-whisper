# Phase 1 - macOS App + Local Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed Codevo Whisper app the owner can install on his Mac and use every day: hold the hotkey, speak, release, and the text from a locally downloaded model appears at the cursor; everything is configurable in a UI that follows the mockup.

**Architecture:** pnpm monorepo. `apps/desktop` is an Electron app (main process in TypeScript, renderer in React + Vite via electron-vite). A Swift helper (`native/macos-helper`) handles hotkeys, focus checks, clipboard and paste over JSON lines on stdio. Audio is captured in a hidden renderer with an AudioWorklet and streamed to main as PCM16 16 kHz. `packages/stt-runner` runs the bundled `transcribe-cli` (transcribe.cpp, Metal) per chunk. Engines sit behind `TranscriptionEngine` (Strategy) so phase 2 can add `RemoteEngine`.

**Tech Stack:** Node 24 LTS, pnpm 10.34.5, TypeScript strict ESM, Electron 45, electron-vite, React 19, Vitest, Playwright (`_electron`), electron-builder 26 with `electronFuses`, Swift 6 (swiftc), transcribe.cpp `8facde6fcd8fb9caa585a5788ab450df6e8ec7db`.

**Spec:** `docs/specs/2026-10-25-codevo-whisper-design.md` (sections 2, 4.6, 5, 7, 10 fuses, 12 phase 1). Phase 0 evidence: `docs/spikes/macos-input.md`, `docs/spikes/transcribe-macos.md`, `docs/spikes/signed-update.md`. Model catalog input: `docs/research/model-catalog.draft.json` (from the model research; Task 7 waits for it). UI reference: the mockup at `~/.t3/scratch/2026-10-25-moja-otazka-pouzivam-t3-code-3289f38e/mockup/index.html` (copy it into `docs/design/mockup.html` in Task 1).

## Global Constraints

- macOS 13+ on arm64 and x64; this phase is tested on the owner's Apple Silicon Mac. Linux code paths are not built in this phase but no macOS API leaks into shared modules (platform specifics behind interfaces).
- Bundle ID `app.codevo.whisper`, product name `Codevo Whisper`, signing identity `Developer ID Application: codevo s.r.o. (U574W69TH6)`. Helper and engine binaries signed with identifiers `app.codevo.whisper.input-helper` and `app.codevo.whisper.transcribe-cli`.
- All UI copy in Slovak with correct diacritics, wording from the mockup where it exists. Codevo logo from `codevo.app` favicon (paths in the mockup). Amber accent `#F0A23A`, logo cyan only in the logo.
- Electron hardening (spec 4.6): `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, strict CSP (`default-src 'self'`), navigation and `window.open` blocked, one narrow typed preload API, all IPC payloads validated in main. Fuses (spec 10): `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`, `enableCookieEncryption: true`.
- Insertion rules exactly as spec 5.2 (three checks, Command down / V down / V up / Command up, restore after 500 ms only if unchanged, copy-only when not editable, Ctrl+Cmd+V paste last).
- Microphone rules exactly as spec 5.5. Microphone open only while recording.
- Models: download only on explicit click, `.download` temp file, SHA-256 while streaming, atomic rename, never at startup (spec 7). Default on Apple Silicon: Parakeet Ultra F16 with Metal; Intel: CPU backend.
- No partials in this phase. Transcription after key release, audio cut into chunks of at most 25 s, transcribed sequentially, joined with a single space. Overlay "Živý text" option is visible but disabled with the note "Príde v ďalšej verzii".
- "Kde beží prepis": option "Lokálne" active; option "Server" visible but disabled with "Príde v ďalšej verzii".
- Allowed test fakes (true external/OS boundaries only): `FakeInputHelper` implementing the `InputHelper` interface (keyboard, clipboard, accessibility of the OS), a fake `transcribe-cli` executable script, a local HTTP server standing in for Hugging Face, and an in-process PCM source implementing `AudioCapture` (OS microphone) in session tests. Everything else runs for real.
- No code comments. Guard clauses, no `else`. Small focused files. Interfaces for swappable parts.
- Verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` (Vitest), `pnpm --filter @codevo-whisper/desktop test:e2e` (Playwright). Native builds (Swift helper, transcribe-cli) and the packaged app in Task 12 are built because they are deliverables.
- Commit after each task directly to `main`; no push until the owner says so.

## Review Focus

- The configured microphone disappears between two dictations (AirPods taken out): recording must still work with the default device and say so. Pinned in Task 5 Step 1 (`falls back to the default device when the chosen one is missing`).
- The model file is deleted or corrupted on disk after download: dictation must fail with a clear message pointing to Nastavenia, never hang or crash. Pinned in Task 6 Step 1 (`reports a missing model`) and Task 7 Step 1 (`marks a model with a wrong hash as broken on verify`).
- Hotkey pressed again while the previous transcription is still running: the new recording starts, the old result is still inserted or kept as the last transcript, nothing is lost or inserted twice. Pinned in Task 9 Step 1 (`a new session while the previous one is transcribing keeps both results`).
- Download interrupted (network drop, app quit): next start shows "Pokračovať v sťahovaní" and resumes; a resumed file with a wrong hash is deleted. Pinned in Task 7 Step 1 (`resumes a partial download`, `deletes a resumed file with a wrong hash`).
- Very long dictation (5 minutes): all chunks transcribed in order, no chunk over 25 s, text complete. Pinned in Task 6 Step 1 (`transcribes 5 minutes in ordered chunks`).

---

### Task 1: Monorepo and desktop app skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `vitest.workspace.ts`, `.nvmrc`, `README.md`; extend existing `.gitignore` with `out/`, `apps/desktop/resources/bin/`
- Create: `apps/desktop/package.json`, `electron.vite.config.ts`, `src/main/index.ts`, `src/main/security/harden.ts`, `src/main/windows/main-window.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles/tokens.css`, `playwright.config.ts`
- Create: `docs/design/mockup.html` (copy of the mockup)
- Test: `apps/desktop/e2e/launch.spec.ts`, `apps/desktop/test/harden.test.ts`

**Interfaces:**
- Produces: root scripts `lint`, `typecheck`, `test`; desktop scripts `dev`, `build`, `test`, `test:e2e`; workspace globs `apps/*`, `packages/*`, `tools/*`; `hardenWebContents(contents: WebContents): void`; `createMainWindow(): BrowserWindow`; design tokens (colors, radii, fonts) in `tokens.css` taken from the mockup.

- [ ] **Step 1: Write the failing tests.** `launch.spec.ts`: launching the built app shows a window titled `Codevo Whisper` with a sidebar containing `Domov`, `Server`, `Nastavenia`, `Súkromie`. `harden.test.ts`: `blocks navigation to external URLs`, `denies window.open`.
- [ ] **Step 2: Run** `pnpm install && pnpm test && pnpm --filter @codevo-whisper/desktop test:e2e`. Expected: FAIL.
- [ ] **Step 3: Implement** the scaffold, hardened main window (webPreferences from Global Constraints, CSP via `session.webRequest.onHeadersReceived` for packaged builds and a meta tag in `index.html`), sidebar shell with the four empty pages, tokens from the mockup.
- [ ] **Step 4: Run** lint, typecheck, test, test:e2e. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(desktop): monorepo and hardened app skeleton"`

---

### Task 2: Settings store and typed IPC

**Files:**
- Create: `apps/desktop/src/shared/settings.ts`, `src/shared/ipc-contract.ts`, `src/main/settings/settings-store.ts`, `src/main/ipc/register-ipc.ts`, `src/main/ipc/validate.ts`
- Modify: `src/preload/index.ts`
- Test: `apps/desktop/test/settings-store.test.ts`, `test/ipc-validate.test.ts`

**Interfaces:**
- Produces:
  - `type Settings = { hotkey: HotkeySetting; mode: 'hold' | 'toggle'; language: 'sk' | 'en' | 'cs' | 'auto'; microphone: { deviceId: string | null; label: string | null }; engineOrder: Array<'local' | 'server'>; localModelId: string | null; insertion: 'paste' | 'clipboard'; overlay: 'indicator' | 'live'; launchAtLogin: boolean; onboardingDone: boolean }`
  - `type HotkeySetting = { keycode: 54 | 58 | 61 | 62 | 63; label: string } | null` (null until the user records one)
  - Defaults: `hotkey: null`, `mode: 'hold'`, `language: 'sk'`, `microphone: { deviceId: null, label: null }` (system default), `engineOrder: ['local']`, `localModelId: null`, `insertion: 'paste'`, `overlay: 'indicator'`, `launchAtLogin: false`, `onboardingDone: false`
  - `class SettingsStore { constructor(file: string); load(): Promise<Settings>; get(): Settings; update(patch: Partial<Settings>): Promise<Settings>; onChange(listener: (next: Settings, previous: Settings) => void): () => void }` - JSON file `settings.json` in `app.getPath('userData')`, atomic write, unknown or invalid fields replaced by defaults on load
  - `ipc-contract.ts`: one `IpcApi` type listing every renderer-callable method and every main-to-renderer event (later tasks add entries); `window.codevo` in the preload implements it
  - `validateSettingsPatch(input: unknown): Partial<Settings>` throws `IpcValidationError`

- [ ] **Step 1: Write the failing tests:** `returns defaults for a missing file`, `persists an update`, `replaces invalid fields with defaults on load`, `notifies listeners with next and previous`, `survives a stray temp file`; `rejects unknown keys`, `rejects a keycode outside the allowed set`, `rejects engineOrder containing server in this phase` (only `['local']` accepted until phase 2).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(desktop): settings store and typed IPC"`

---

### Task 3: macOS input helper

**Files:**
- Create: `native/macos-helper/Sources/*.swift` (promoted from `spikes/macos-input/helper/Sources`, without the selftest fixtures), `native/macos-helper/build.sh`
- Create: `apps/desktop/src/main/helper/input-helper.ts`, `src/main/helper/helper-process.ts`, `src/main/helper/fake-input-helper.ts`
- Test: `apps/desktop/test/helper-process.test.ts`, `test/input-helper.integration.test.ts`

**Interfaces:**
- Produces:
  - Helper commands (JSON lines `{ "id", "cmd", "args" }` -> `{ "id", ...result }`, events `{ "event", ... }`): `ping`, `permissions`, `request-permission {kind: listen|accessibility}`, `frontmost`, `secure-input`, `focused-element`, `clipboard-save`, `clipboard-write {text}`, `clipboard-restore {expectedText}`, `paste` (Command down, V down, V up, Command up), `listen-start {keycodes}`, `listen-stop`, `record-key` (emits `{event:"recorded", keycode}` for the next supported modifier press, or `{event:"record-unsupported", keycode}` for any other key), events `key {phase: down|up, keycode, ts}` and `shortcut {name: "paste-last"}` for Ctrl+Cmd+V
  - `interface InputHelper { start(): Promise<void>; stop(): Promise<void>; permissions(): Promise<Permissions>; requestPermission(kind: 'listen' | 'accessibility'): Promise<void>; frontmost(): Promise<AppTarget | null>; secureInput(): Promise<boolean>; focusedElement(): Promise<{ editable: boolean | null; role: string | null }>; saveClipboard(): Promise<void>; writeClipboard(text: string): Promise<void>; restoreClipboard(expectedText: string): Promise<boolean>; paste(): Promise<void>; listen(keycodes: number[]): Promise<void>; recordKey(timeoutMs: number): Promise<number | null>; onKey(listener: (event: KeyEvent) => void): () => void; onShortcut(listener: (name: 'paste-last') => void): () => void }`
  - `class HelperProcessInputHelper implements InputHelper` (spawns the binary, request ids, 2 s timeout per command, restarts the helper once on crash)
  - `class FakeInputHelper implements InputHelper` (in-memory OS: scripted frontmost app, editable flag, clipboard, emits keys on demand) used by tests of later tasks
  - `type AppTarget = { bundleId: string; pid: number; name: string; windowId: number | null }`

- [ ] **Step 1: Write the failing tests.** `helper-process.test.ts` (against a tiny Node script that speaks the protocol): `matches responses by id`, `times out a silent command`, `restarts once after a crash and then reports failure`. `input-helper.integration.test.ts` (runs only on macOS, uses the real built helper, needs no permissions): `ping answers`, `permissions returns three booleans`, `frontmost returns a bundle id`, `secure-input returns a boolean`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Build: `swiftc -O -swift-version 6 -target <arch>-apple-macos13.0 -framework AppKit -framework Carbon -framework IOKit -framework ApplicationServices Sources/*.swift -o build/<arch>/codevo-input-helper`; desktop resolves the binary from `resources/bin/<arch>/` when packaged and from `native/macos-helper/build/<arch>/` in dev.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(native): macOS input helper"`

---

### Task 4: Hotkey service and key recorder

**Files:**
- Create: `apps/desktop/src/main/hotkey/hotkey-service.ts`, `src/main/hotkey/reset-guard.ts`, `src/main/hotkey/key-recorder.ts`
- Test: `apps/desktop/test/hotkey-service.test.ts`, `test/key-recorder.test.ts`

**Interfaces:**
- Consumes: `InputHelper`, `SettingsStore`.
- Produces:
  - `class HotkeyService { constructor(helper: InputHelper, settings: SettingsStore, power: PowerEvents, clock?: () => number); start(): Promise<void>; onStart(listener: () => void): () => void; onStop(listener: (reason: 'released' | 'toggled' | 'max-duration' | 'lock' | 'suspend') => void): () => void; pause(): void; resume(): void }` - hold mode: down starts, up stops; toggle mode: down starts, next down stops; reset on lock/suspend; maximum 120000 ms; a late up after a reset is ignored
  - `interface PowerEvents { on(event: 'lock-screen' | 'suspend', listener: () => void): () => void }` (production adapter over Electron `powerMonitor`)
  - `class KeyRecorder { constructor(helper: InputHelper); record(timeoutMs = 10000): Promise<HotkeySetting | 'unsupported' | 'timeout'> }` with labels `Fn / 🌐`, `Ľavý ⌥ Option`, `Pravý ⌥ Option`, `Pravý ⌘ Command`, `Pravý ⌃ Control`

- [ ] **Step 1: Write the failing tests** (with `FakeInputHelper` and a fake `PowerEvents`): `hold mode starts on down and stops on up`, `toggle mode stops on second down`, `ignores keys other than the configured one`, `stops on lock and ignores the late up`, `stops at max duration`, `uses the new key after a settings change without restart`, `does nothing while paused`, `does nothing while no hotkey is configured`; recorder: `returns the recorded key with its label`, `returns unsupported for a letter key`, `returns timeout`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(desktop): hotkey service and key recorder"`

---

### Task 5: Audio capture and microphone selection

**Files:**
- Create: `apps/desktop/src/renderer/capture/capture.html`, `src/renderer/capture/capture.ts`, `src/renderer/capture/pcm-worklet.ts`, `src/main/audio/capture-window.ts`, `src/main/audio/audio-capture.ts`, `src/main/audio/device-resolver.ts`, `src/shared/pcm.ts`
- Test: `apps/desktop/test/device-resolver.test.ts`, `test/pcm.test.ts`, `apps/desktop/e2e/capture.spec.ts`

**Interfaces:**
- Produces:
  - `type AudioDevice = { deviceId: string; label: string; isBluetooth: boolean }`
  - `resolveDevice(devices: AudioDevice[], chosen: { deviceId: string | null; label: string | null }): { device: AudioDevice | null; fallback: boolean }` - match by deviceId, then by label (deviceIds can change after reconnect), else system default with `fallback: true`; `isBluetooth` from label heuristics (`AirPods`, `Bluetooth`, `Headset`, `Buds`)
  - `class AudioCapture { listDevices(): Promise<AudioDevice[]>; onDevicesChanged(listener: (devices: AudioDevice[]) => void): () => void; start(chosen: Settings['microphone']): Promise<{ fallback: boolean; deviceLabel: string }>; stop(): Promise<Uint8Array>; onLevel(listener: (rms: number) => void): () => void; startMeter(chosen: Settings['microphone']): Promise<void>; stopMeter(): Promise<void> }` - hidden sandboxed capture window, `getUserMedia({ audio: { deviceId, echoCancellation: false, noiseSuppression: false, autoGainControl: true } })`, AudioWorklet downsamples to 16 kHz mono PCM16 LE, frames of 100 ms over IPC, level (RMS) every 50 ms; stream stopped and tracks released on `stop`
  - `pcm.ts`: `concatPcm(frames: Uint8Array[]): Uint8Array`, `pcmDurationMs(pcm: Uint8Array): number`, `downsampleFloat32(input: Float32Array, inputRate: number): Int16Array`

- [ ] **Step 1: Write the failing tests:** `falls back to the default device when the chosen one is missing`, `matches by label when the deviceId changed`, `flags AirPods as Bluetooth`; `downsamples 48 kHz to 16 kHz with the right length`, `pcmDurationMs of 32000 bytes is 1000`; e2e `capture.spec.ts` with Chromium fake media (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`): start, wait 1 s, stop returns about 32000 bytes (±10 %), level events arrive, the media track is ended after stop.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(desktop): audio capture and microphone selection"`

---

### Task 6: STT runner, transcribe.cpp build and LocalEngine

**Files:**
- Create: `packages/stt-runner/package.json`, `src/index.ts`, `src/wav.ts`, `src/run-transcribe-cli.ts`, `test/support/fake-transcribe-cli.sh`
- Create: `native/transcribe/build.sh` (clone pinned commit, flags from spec 7, output `apps/desktop/resources/bin/<arch>/transcribe-cli`)
- Create: `apps/desktop/src/main/engines/transcription-engine.ts`, `src/main/engines/local-engine.ts`, `src/main/engines/chunk-pcm.ts`
- Test: `packages/stt-runner/test/run-transcribe-cli.test.ts`, `test/wav.test.ts`, `apps/desktop/test/local-engine.test.ts`, `test/chunk-pcm.test.ts`, `apps/desktop/test/local-engine.real.test.ts` (runs only when `CW_REAL_MODEL` points to a model file)

**Interfaces:**
- Produces:
  - `pcmToWav(pcm: Uint8Array, sampleRate = 16000): Uint8Array`
  - `runTranscribeCli(options: { binary: string; model: string; backend: 'metal' | 'cpu' | 'vulkan'; threads: number; language: 'sk' | 'en' | 'cs' | 'auto'; pcm: Uint8Array; timeoutMs?: number; signal?: AbortSignal }): Promise<string>` - private temp dir, args `--model --backend --language --threads --timestamps none --quiet --output <out> <wav>`, max 16000 bytes output, temp dir removed in all cases, process killed on timeout (default 120000) or abort
  - `chunkPcm(pcm: Uint8Array, maxSeconds = 25): Uint8Array[]` (never splits a sample, drops a tail under 640 bytes)
  - `interface TranscriptionEngine { readonly id: 'local' | 'server'; isReady(): Promise<{ ready: boolean; reason?: 'no-model' | 'model-missing' | 'model-broken' | 'binary-missing' }>; transcribe(pcm: Uint8Array, language: Settings['language'], signal: AbortSignal): Promise<string> }`
  - `class LocalEngine implements TranscriptionEngine { constructor(deps: { binary: string; models: ModelManager; settings: SettingsStore; arch: 'arm64' | 'x64' }) }` - backend `metal` on arm64, `cpu` on x64; chunks transcribed sequentially, trimmed results joined with one space, empty chunks skipped
  - `ModelManager` is defined in Task 7; until then LocalEngine depends on the narrow interface `interface ActiveModel { activeModelPath(): Promise<string | null>; verifyActive(): Promise<'ok' | 'missing' | 'broken'> }`

- [ ] **Step 1: Write the failing tests:** runner: `passes the expected arguments`, `returns trimmed text`, `rejects oversized output`, `kills on timeout`, `removes the temp dir after success and failure`; wav header test; chunk: 60 s -> 25/25/10 s; local engine (fake binary): `reports no-model when none is active`, `reports a missing model`, `transcribes 5 minutes in ordered chunks` (fake echoes a chunk index, result joined in order, every chunk ≤ 25 s), `uses metal on arm64 and cpu on x64`, `stops on abort`; real test: Parakeet transcribes `spikes/transcribe-macos/sample.wav` PCM to the expected Slovak sentence.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Build the arm64 binary once with `native/transcribe/build.sh arm64` and sign it in Task 12.
- [ ] **Step 4: Run** the tests; run the real test with `CW_REAL_MODEL=spikes/transcribe-macos/parakeet-ultra-F16.gguf`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: stt runner, transcribe.cpp build and local engine"`

---

### Task 7: Model catalog and model manager

**Files:**
- Create: `apps/desktop/resources/model-catalog.json` (from `docs/research/model-catalog.draft.json`; all four entries are owner-approved: parakeet-ultra-q8, canary-1b-v2-q8, parakeet-ultra-q4, tc-whisper-turbo-q8; keep `languageHint` and the per-platform defaults), `apps/desktop/src/main/models/model-catalog.ts`, `src/main/models/model-manager.ts`, `src/main/models/downloader.ts`, `src/main/models/warm-up.ts`
- Test: `apps/desktop/test/model-catalog.test.ts`, `test/model-manager.test.ts`

**Interfaces:**
- Consumes: catalog entry shape from the research: `{ id, name, engine, languages, sizeBytes, license, attribution, source: { repo, revision, file }, sha256, roles, minRamBytes }`.
- Produces:
  - `loadCatalog(file: string): CatalogEntry[]` (validates every field; a source URL is `https://huggingface.co/<repo>/resolve/<revision>/<file>`)
  - `type ModelState = { id: string; status: 'not-downloaded' | 'downloading' | 'paused' | 'ready' | 'broken'; receivedBytes: number; totalBytes: number }`
  - `class ModelManager implements ActiveModel { constructor(deps: { dir: string; catalog: CatalogEntry[]; settings: SettingsStore; fetchImpl?: typeof fetch; warmUp: (path: string) => Promise<void> }); states(): ModelState[]; download(id: string): Promise<void>; pause(id: string): void; delete(id: string): Promise<void>; activate(id: string): Promise<void>; verify(id: string): Promise<'ok' | 'missing' | 'broken'>; activeModelPath(): Promise<string | null>; verifyActive(): Promise<'ok' | 'missing' | 'broken'>; onChange(listener: (states: ModelState[]) => void): () => void }` - resume with HTTP `Range` from `<file>.download`, hash computed over the whole file after resume, atomic rename, only one download at a time, `activate` requires `ready` and runs `warmUp` once
  - `warmUp(path)` runs one transcription of 1 s of silence with the active backend (shader compile, spec 7)

- Also produces: `defaultModelId(platform: { os: 'darwin' | 'linux'; arch: 'arm64' | 'x64'; gpu: boolean }): string` from the catalog defaults; `languageHint(id): 'ignored' | 'required' | 'optional'`; LocalEngine readiness reason `language-required` when the active model's hint is `required` and the language setting is `auto` (Canary translates otherwise).

- [ ] **Step 1: Write the failing tests** (real local HTTP server with Range support; also `default model is parakeet-ultra-q8 on arm64 and parakeet-ultra-q4 on x64`, `canary with language auto is not ready with language-required`): `downloads, verifies and renames`, `deletes on hash mismatch and reports broken`, `resumes a partial download`, `deletes a resumed file with a wrong hash`, `pause keeps the partial file`, `never downloads without a call` (constructing the manager and reading states makes no HTTP request), `activate requires a ready model and runs warm-up once`, `marks a model with a wrong hash as broken on verify`, `delete of the active model clears localModelId`; catalog: `rejects an entry without sha256`, `builds the Hugging Face URL`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(desktop): model catalog and model manager"`

---

### Task 8: Insertion and paste last transcript

**Files:**
- Create: `apps/desktop/src/main/insertion/insertion-service.ts`, `src/main/insertion/last-transcript.ts`
- Test: `apps/desktop/test/insertion-service.test.ts`

**Interfaces:**
- Consumes: `InputHelper`, `SettingsStore`.
- Produces:
  - `type InsertionOutcome = 'pasted' | 'copied-no-text-field' | 'copied-by-setting' | 'blocked-focus-changed' | 'blocked-secure-input'`
  - `class InsertionService { constructor(helper: InputHelper, settings: SettingsStore, sleep?: (ms: number) => Promise<void>); insert(text: string, target: AppTarget | null): Promise<InsertionOutcome>; pasteLast(): Promise<InsertionOutcome | 'no-transcript'> }` - order: focus check (skipped for pasteLast), secure input, focused element; paste path saves clipboard, writes text, `paste()`, waits 500 ms, `restoreClipboard(text)`; copy paths write the clipboard and never restore; `insertion: 'clipboard'` setting always copies (`copied-by-setting`)
  - `class LastTranscript { set(text: string): void; get(): string | null }`

- [ ] **Step 1: Write the failing tests** (with `FakeInputHelper`): `pastes into an editable field and restores the clipboard`, `does not restore when the clipboard changed meanwhile`, `copies only when the focused element is not editable`, `pastes when editability is unknown`, `blocks when the frontmost app changed`, `blocks on secure input`, `copies by setting`, `paste last uses the last transcript and current focus`, `paste last without a transcript returns no-transcript`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(desktop): insertion service and paste last transcript"`

---

### Task 9: Dictation session, overlay and tray

**Files:**
- Create: `apps/desktop/src/main/session/dictation-session.ts`, `src/main/session/session-coordinator.ts`, `src/main/windows/overlay-window.ts`, `src/main/tray/tray-menu.ts`, `src/renderer/overlay/overlay.html`, `src/renderer/overlay/Overlay.tsx`, `src/main/app/compose.ts`
- Test: `apps/desktop/test/session-coordinator.test.ts`, `apps/desktop/e2e/overlay.spec.ts`

**Interfaces:**
- Consumes: Tasks 2-8.
- Produces:
  - `type OverlayState = { kind: 'hidden' } | { kind: 'recording'; elapsedMs: number; level: number; language: string; fallbackDevice?: string } | { kind: 'processing' } | { kind: 'inserted'; appName: string } | { kind: 'copied' } | { kind: 'blocked'; reason: 'focus' | 'secure' } | { kind: 'error'; message: string; action?: 'open-settings' }`
  - `class SessionCoordinator { constructor(deps: { hotkey: HotkeyService; capture: AudioCapture; engine: TranscriptionEngine; insertion: InsertionService; lastTranscript: LastTranscript; helper: InputHelper; settings: SettingsStore; overlay: (state: OverlayState) => void }); start(): void }` - on hotkey start: capture target via `helper.frontmost()` and warm `focusedElement()`, start capture (show fallback notice), overlay recording; on stop: stop capture, overlay processing, engine transcribe, set last transcript, insert, overlay result for 1.2 s then hidden; engine not ready -> overlay error "Nemáte stiahnutý model" / "Model chýba alebo je poškodený" with action `open-settings`, audio discarded
  - Overlay window per spec 5.3 / `docs/spikes/macos-input.md` Decision (panel, non-focusable, screen-saver level, all workspaces incl. fullscreen, `showInactive`, bottom-center of the display under the cursor); Indikátor mode visuals from the mockup (pill with dot and waveform, Spracúvam, Vložené, Skopírované - vlož cez ⌘V, error states)
  - Tray menu: status line, "Posledné diktovanie" (copy), "Vložiť posledný prepis ⌃⌘V", "Pozastaviť diktovanie" / "Pokračovať", submenu "Mikrofón" (devices + Systémový predvolený), submenu "Jazyk", "Otvoriť Codevo Whisper", "Nastavenia…", "Ukončiť Codevo Whisper"; template icon from the codevo mark, states idle / recording / processing / paused / error

- [ ] **Step 1: Write the failing tests** (real collaborators with `FakeInputHelper`, fake transcribe binary, real `ModelManager` over a temp dir; `AudioCapture` replaced by an in-process PCM source implementing the same interface): `records, transcribes and inserts`, `shows the fallback microphone notice`, `shows no-model error and opens settings action`, `a new session while the previous one is transcribing keeps both results`, `blocked insertion keeps the text as last transcript`, `paste-last shortcut inserts the last transcript`. e2e `overlay.spec.ts`: overlay window is not focusable and shows the recording state from an injected state.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and wire everything in `compose.ts` (composition root; the only place that knows concrete classes).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(desktop): dictation session, overlay and tray"`

---

### Task 10: Statistics and Domov page

**Files:**
- Create: `apps/desktop/src/main/stats/stats-store.ts`, `src/main/stats/stats-summary.ts`, `src/renderer/pages/Home.tsx`, `src/renderer/components/{StatTiles,WordsChart,LastTranscriptCard}.tsx`
- Modify: `src/main/session/session-coordinator.ts` (record a dictation after a successful transcription)
- Test: `apps/desktop/test/stats-store.test.ts`, `test/stats-summary.test.ts`, `apps/desktop/e2e/home.spec.ts`

**Interfaces:**
- Produces:
  - `type DayStats = { date: string; words: number; dictations: number; seconds: number }` (date `YYYY-MM-DD` in local time)
  - `class StatsStore { constructor(file: string, clock?: () => Date); record(entry: { words: number; seconds: number }): Promise<void>; days(): Promise<DayStats[]>; reset(): Promise<void> }` - `stats.json` in userData, atomic write, only counters (spec 5.6), corrupt file -> start empty and log
  - `summarize(days: DayStats[], period: 'today' | 'week' | 'total', today: string): { words: number; dictations: number; seconds: number; wordsPerMinute: number; savedSeconds: number; streakDays: number; last7: Array<{ date: string; words: number }> }` - savedSeconds = words / 40 * 60 - seconds (never below 0), week = Monday to today, streak counts back from today (or yesterday if today has none)
  - Word count: split on whitespace, count tokens containing a letter or digit
  - IPC: `getStats(): Promise<DayStats[]>`, `resetStats(): Promise<void>`, `getStatus(): Promise<AppStatus>`, `getLastTranscript(): Promise<string | null>`, events `stats-changed`, `status-changed`
  - `type AppStatus = { hotkeyLabel: string | null; modelReady: boolean; permissionsOk: boolean; paused: boolean }` (permissionsOk from a minimal `PermissionsService.status()`, ruling R3)
  - Home page per the mockup (`docs/design/mockup.html`, Domov tab): status banner or call to action when hotkey, model or a permission is missing; Štatistiky with Dnes / Tento týždeň / Celkom switch, six tiles, 7-day chart, the line "Štatistiky sú len súčty čísel na tomto Macu, bez textu."; card "Posledné diktovanie" with copy and the note "Uchováva sa len do zatvorenia aplikácie. Nič sa neukladá na disk."

- [ ] **Step 1: Write the failing tests:** store: `records into today's counters`, `starts a new day after midnight`, `file contains only numbers and dates` (no text), `reset deletes the counters`, `corrupt file starts empty`; summary: `today, week from Monday, total`, `words per minute from recorded seconds`, `saved time uses 40 words per minute and never goes negative`, `streak counts consecutive days and tolerates no dictation yet today`, `last7 fills missing days with 0`; coordinator: `records stats after a successful dictation and not after an empty or failed one`; e2e: banner shows the hotkey label or the call to action, tiles show values from seeded stats and switch periods, copy writes the clipboard, last transcript is empty after relaunch.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(desktop): statistics and home page"`

---

### Task 11: Settings, Server, Súkromie pages and onboarding

**Files:**
- Create: `apps/desktop/src/renderer/pages/Settings.tsx`, `pages/Server.tsx`, `pages/Privacy.tsx`, `pages/Onboarding.tsx`, `src/renderer/components/{HotkeyRecorder,MicrophonePicker,LevelMeter,ModelList,SegmentedControl,Switch}.tsx`, `src/main/permissions/permissions-service.ts`, `src/main/system/login-item.ts`
- Test: `apps/desktop/e2e/settings.spec.ts`, `e2e/onboarding.spec.ts`, `apps/desktop/test/permissions-service.test.ts`

**Interfaces:**
- Consumes: everything above through `IpcApi` (add the needed methods/events to `ipc-contract.ts`).
- Produces:
  - Nastavenia sections (copy from the mockup): Diktovanie (Klávesová skratka with recorder, Režim Podrž/Prepínanie, Jazyk; "Automaticky" disabled with a note when the active model requires a language), Zobrazenie panela (Indikátor active; Živý text disabled "Príde v ďalšej verzii"), Kde beží prepis (Lokálne active; Server disabled "Príde v ďalšej verzii"), Lokálny model (catalog with roles, size, license, Stiahnuť / Pozastaviť / Pokračovať / Odstrániť / Použiť, progress bar, broken state with Stiahnuť znova), Mikrofón (picker with Systémový predvolený, live meter, Bluetooth hint per spec 5.5), Vkladanie textu (Vložiť do aktívnej aplikácie / Iba skopírovať), Zobrazenie panela (Indikátor; Živý text disabled), Systém (Spustiť pri prihlásení, Vynulovať štatistiky)
  - Server page: explanation of the coming server mode, disabled pairing area
  - Súkromie page: data flow for local mode (all on this Mac; no network except model downloads from Hugging Face and update checks), what is stored where
  - Onboarding (first run until `onboardingDone`): 1) mikrofón permission, 2) Input Monitoring and Accessibility with deep links `x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent` / `?Privacy_Accessibility`, live status, "Reštartovať" button when Input Monitoring needs a relaunch, 3) hotkey recorder, 4) model choice and download (recommended entry preselected), 5) try it ("Podržte <kláves> a povedzte niečo")
  - `class PermissionsService { status(): Promise<{ microphone: 'granted' | 'denied' | 'not-determined'; inputMonitoring: boolean; accessibility: boolean }>; request(kind: 'microphone' | 'input-monitoring' | 'accessibility'): Promise<void>; openSettings(kind: 'input-monitoring' | 'accessibility' | 'microphone'): Promise<void> }`

- [ ] **Step 1: Write the failing tests:** e2e settings: changing Režim, Jazyk, Vkladanie, Spustiť pri prihlásení persists across a relaunch; hotkey recorder shows the recorded label (helper fake emits keycode 62 -> `Pravý ⌃ Control`); Server option and Živý text are disabled with the note; model list shows catalog entries with sizes; e2e onboarding: shown on first run, skipped after completion, step 4 preselects the recommended model; unit: permissions mapping from helper and `systemPreferences.getMediaAccessStatus`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** following the mockup visuals (tokens from Task 1, Codevo logo, light and dark mode via `prefers-color-scheme`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(desktop): settings, server, privacy pages and onboarding"`

---

### Task 12: Signed local build for the owner

**Files:**
- Create: `apps/desktop/electron-builder.yml`, `apps/desktop/build/entitlements.mac.plist`, `apps/desktop/build/icon.icns` (from the codevo mark), `scripts/build-mac-local.sh`
- Create: `docs/operations/macos-local-build.md`

**Interfaces:**
- Produces: `scripts/build-mac-local.sh arm64` builds the helper and transcribe-cli for the arch, signs both with hardened runtime and their identifiers, packages `Codevo Whisper.app` (target `dir`, no DMG, no notarization in this phase) with fuses from Global Constraints and entitlements `com.apple.security.device.audio-input` (plus `com.apple.security.cs.allow-jit` only if Electron needs it), signs the app with the Developer ID identity, and copies it to `~/Applications/Codevo Whisper.app`.

- [ ] **Step 1: Build** `scripts/build-mac-local.sh arm64`. Expected: `codesign --verify --deep --strict` passes, `npx @electron/fuses read --app "~/Applications/Codevo Whisper.app"` shows the fuse set, `ELECTRON_RUN_AS_NODE=1 open -W "~/Applications/Codevo Whisper.app"` does not run as Node (the app starts normally).
- [ ] **Step 2: Smoke run** from `~/Applications` (`env -u ELECTRON_RUN_AS_NODE open`): onboarding appears; record in the log that permissions are requested for `Codevo Whisper` (not Electron).
- [ ] **Step 3: Owner test session** using the checklist in `docs/operations/macos-local-build.md`: onboarding, hotkey recording (right Control on the owner's keyboard), model download of the recommended model, dictation into T3 Code / Notes / Slack / VS Code / Terminal / Chrome, Finder copy-only, Ctrl+Cmd+V, microphone switch and AirPods fallback, settings persistence, launch at login. Record results in the doc.
- [ ] **Step 4: Commit** `git commit -m "build(desktop): signed local macOS build and test checklist"`

---

### Task 13: Phase review

- [ ] **Step 1:** `coderabbit review --agent --base <first commit of this phase>^`; fix valid findings, note rejected ones in `docs/reviews/phase-1.md`.
- [ ] **Step 2:** gpt-6.1-sol review (`codex exec -m gpt-6.1-sol -s read-only`) of `apps/desktop/src/main` (security hardening, IPC validation, insertion rules, model download integrity, no transcript written to disk) against spec 4.6, 5, 7, 10.
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @codevo-whisper/desktop test:e2e`. Expected: PASS.
- [ ] **Step 4:** Owner OK.
