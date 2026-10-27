# Auto-update (Stream H) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (stream rules: no subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-app update from GitHub Releases in the desktop app: background check, download, user-confirmed restart and install, Slovak UI in Nastavenia > Systém and the tray, platform policy (macOS and AppImage in-app, deb manual notice), N -> N+1 manual procedure.

**Architecture:** `UpdateService` (state machine) in `apps/desktop/src/main/updates/` depends only on the `AppUpdater` adapter interface; `ElectronUpdaterAdapter` wraps electron-updater (third-party boundary), `FakeAppUpdater` stands in for it in unit tests and in e2e mode (loaded by dynamic import, excluded from the package like `FakeInputHelper`). `UpdateScheduler` triggers background checks. The platform policy is a Strategy map per `process.platform`. IPC follows the existing handler-group pattern; the renderer row reads a pushed `UpdateStatus`.

**Tech Stack:** Electron 45, electron-updater 6.8.11 (devDependency, bundled into `out/main` by electron-vite like react), Vitest, Playwright.

**Spec:** `docs/specs/2026-10-25-codevo-whisper-design.md` sections 3 (UpdateService), 7 (warm-up after update), 10 (release); `docs/spikes/signed-update.md`; `docs/operations/release.md`.

## Decision: auto-download, explicit install

The service downloads an update as soon as a check finds one (in-app mode only) and installs only after the user clicks "Reštartovať a aktualizovať" (settings row or tray). electron-updater runs with `autoDownload = false` (the service drives the download) and `autoInstallOnAppQuit = false`.

Why this over download-on-request: one user action instead of two, and the tray item ("ready") appears without the user ever opening Nastavenia, which is the only way most users would learn about an update. It stays safe: on macOS, with `autoInstallOnAppQuit = false`, `MacUpdater` does not hand the file to Squirrel.Mac after the download (`MacUpdater.js` `doDownloadUpdate`, `if (this.autoInstallOnAppQuit) nativeUpdater.checkForUpdates()`), so a downloaded but unconfirmed update is never installed by a normal quit; only `quitAndInstall()` feeds it to Squirrel, which still checks the Team ID / bundle ID requirement. On AppImage, `BaseUpdater` installs on quit only with `autoInstallOnAppQuit`. Cost: one ZIP download (about 100-150 MB) per release in the background.

## Global Constraints

- GitHub provider from `app-update.yml` (owner `MatusMockor`, repo `codevo-whisper`, public); no feed URL in code. Private repos out of scope.
- Background check 15 s after start, then every 4 minutes (owner decision 2026-10-27, same cadence as T3 Code). Background checks stay silent: no "checking" state, failures only logged. Never auto-install.
- Linux: in-app only for AppImage (`APPIMAGE` env set); deb and every other Linux package: notice + link `https://github.com/MatusMockor/codevo-whisper/releases/latest`, never download or install (spec 10).
- Unpackaged builds (dev, e2e without the fake): mode `unsupported`, no network.
- Install never during an active dictation; quitting goes through `before-quit` / `QuitGate` (no `app.exit`).
- Fake updater only in e2e mode (`isE2eMode()`), chunk `out/main/fake-app-updater-*.js` excluded in `electron-builder.yml`.
- Code rules: no comments, guard clauses, no else, small files, interfaces for swappable parts. Slovak UI copy with diacritics.
- Shared files (`compose.ts`, `ipc-contract.ts`, `preload/index.ts`, `Settings`/`SystemSection`) changed additively only (Stream E edits them too).

## Review Focus

- Background check fails offline: no error shown, state stays as before, logged (Task 2 test `background check failure keeps the previous phase`).
- User clicks "Reštartovať a aktualizovať" while dictating: refused with `dictation-active`, nothing quits (Task 2 test).
- Install fails after confirmation (Squirrel rejects signature): error state, dictation resumed (Task 2 test `install failure resumes dictation`).
- Overlapping triggers (manual check while background check runs, check during download): single in-flight check, no state regression (Task 2 tests).
- electron-updater emits `error` with no pending call (native updater): logged, never an unhandled `error` event (Task 3 test).

---

### Task 1: Shared types and platform policy

**Files:**
- Create: `apps/desktop/src/shared/updates.ts`, `apps/desktop/src/main/updates/update-policy.ts`
- Test: `apps/desktop/test/update-policy.test.ts`

**Interfaces:**
- Produces (`shared/updates.ts`):
  - `type UpdateMode = 'in-app' | 'manual' | 'unsupported'`
  - `type UpdatePhase = { kind: 'idle'; checked: boolean } | { kind: 'checking' } | { kind: 'available'; version: string } | { kind: 'downloading'; version: string; percent: number } | { kind: 'ready'; version: string } | { kind: 'installing'; version: string } | { kind: 'error'; failed: 'check' | 'download' | 'install' }`
  - `type UpdateStatus = { currentVersion: string; mode: UpdateMode; phase: UpdatePhase }`
  - `type InstallOutcome = 'restarting' | 'dictation-active' | 'not-ready'`
  - `const RELEASES_URL = 'https://github.com/MatusMockor/codevo-whisper/releases/latest'`
- Produces (`update-policy.ts`): `type PlatformFacts = { platform: NodeJS.Platform; isPackaged: boolean; appImage: string | undefined }`, `interface PlatformUpdatePolicy { mode(facts: PlatformFacts): UpdateMode }`, `function resolveUpdateMode(facts: PlatformFacts): UpdateMode` (unpackaged -> `unsupported`; Strategy map `darwin` -> in-app, `linux` -> in-app with non-empty `appImage` else manual; other platforms -> unsupported).

- [ ] Step 1: failing tests: packaged darwin -> `in-app`; linux with `appImage: '/home/u/Codevo.AppImage'` -> `in-app`; linux without / with `''` -> `manual`; `win32` -> `unsupported`; any platform unpackaged -> `unsupported`.
- [ ] Step 2: run `pnpm vitest run apps/desktop/test/update-policy.test.ts`, expect FAIL (module missing).
- [ ] Step 3: implement both files.
- [ ] Step 4: run again, PASS; `pnpm lint && pnpm typecheck`.
- [ ] Step 5: commit `feat(desktop): update types and platform update policy` (also the plan file and the electron-updater devDependency).

### Task 2: UpdateService state machine with the fake adapter

**Files:**
- Create: `apps/desktop/src/main/updates/app-updater.ts`, `update-service.ts`, `fake-app-updater.ts`, `dictation-guard.ts`
- Test: `apps/desktop/test/update-service.test.ts`

**Interfaces:**
- `app-updater.ts`: `type AvailableUpdate = { version: string }`; `interface AppUpdater { check(): Promise<AvailableUpdate | null>; download(onProgress: (percent: number) => void): Promise<void>; install(): Promise<void> }` (`install` rejects when the install fails, never resolves on success because the app quits).
- `dictation-guard.ts`: `type DictationGuard = { isDictating(): boolean; suspend(): () => void }` (suspend returns the release function).
- `update-service.ts`: `class UpdateService` with `constructor(deps: { updater: AppUpdater; mode: UpdateMode; currentVersion: string; dictation: DictationGuard; logger: Logger })`, `status(): UpdateStatus`, `onChange(listener: (status: UpdateStatus) => void): () => void`, `check(): Promise<UpdateStatus>` (user), `checkInBackground(): Promise<void>`, `install(): InstallOutcome`.
- `fake-app-updater.ts`: `class FakeAppUpdater implements AppUpdater` with `latest: string | null`, `checkFails`, `downloadFails`, `holdDownloads` (manual control: `reportProgress(percent)`, `completeDownload()`), `checks: number`, `installs: number`, `failInstall(message)`.

Rules: check allowed from idle/available/error (otherwise returns current status; a concurrent check shares the in-flight promise). Result null -> `idle checked`; version in `in-app` -> `downloading 0` -> progress (integer percent, emit only on change) -> `ready`; in `manual` -> `available`. User check failure -> `error check`; background failure -> previous phase restored, logged. Download failure -> `error download`. `unsupported` mode: check is a no-op. Install: not `ready` or mode not in-app -> `not-ready`; dictating -> `dictation-active`; else `suspend()`, `installing`, `updater.install()`; rejection -> release, `error install`, logged.

- [ ] Step 1: failing tests (real `FakeAppUpdater`, `RecordingLogger`, a guard object): up-to-date check -> `{ kind: 'idle', checked: true }`; update `1.2.0` -> phases `checking, downloading 0, downloading 50, ready` via `onChange`; manual mode stops at `available` and never downloads (`fake.downloads === 0`); unsupported never calls `check` (`fake.checks === 0`); user check error -> `error check`; background check failure keeps the previous phase; download error -> `error download`, next check retries and reaches `ready`; two concurrent checks call the adapter once; check during download keeps downloading; install while dictating -> `dictation-active`, `fake.installs === 0`; install when ready -> `restarting`, phase `installing`, guard suspended; install failure resumes dictation and shows `error install`; install before ready -> `not-ready`.
- [ ] Step 2: run, expect FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run, PASS; lint, typecheck.
- [ ] Step 5: commit `feat(desktop): update service state machine`.

### Task 3: electron-updater adapter and scheduler

**Files:**
- Create: `apps/desktop/src/main/updates/electron-updater-adapter.ts`, `update-scheduler.ts`
- Test: `apps/desktop/test/electron-updater-adapter.test.ts`, `apps/desktop/test/update-scheduler.test.ts`

**Interfaces:**
- `type UpdaterLike` = the subset of electron-updater's `AppUpdater` used (`autoDownload`, `autoInstallOnAppQuit`, `allowDowngrade`, `logger`, `checkForUpdates()`, `downloadUpdate()`, `quitAndInstall(isSilent, isForceRunAfter)`, `on/removeListener` for `'error'` and `'download-progress'`).
- `class ElectronUpdaterAdapter implements AppUpdater` `constructor(updater: UpdaterLike, logger: Logger)`: sets `autoDownload = false`, `autoInstallOnAppQuit = false`, `allowDowngrade = false`, routes the updater logger to `Logger`, registers a permanent `'error'` listener (logs). `check` maps `null` / `isUpdateAvailable === false` to `null`. `download` forwards `percent` from `download-progress` and removes its listener afterwards. `install` calls `quitAndInstall(false, true)` and rejects on the next `'error'`.
- `class UpdateScheduler` `constructor(check: () => Promise<void>, timing = { initialDelayMs: 15_000, intervalMs: 4 * 60 * 1000 })`, `start()`, `dispose()`.

- [ ] Step 1: failing adapter tests with an `EventEmitter`-based stand-in for electron-updater (third-party boundary): flags set on construction; check mapping; progress forwarded and listener removed; install rejects on a later `error`; an `error` with nothing pending is logged and does not throw. Scheduler tests with `vi.useFakeTimers()`: no check before 15 s, one at 15 s, next at 15 s + 4 min, none after `dispose()`.
- [ ] Step 2: run, FAIL. Step 3: implement. Step 4: PASS, lint, typecheck.
- [ ] Step 5: commit `feat(desktop): electron-updater adapter and background update scheduler`.

### Task 4: IPC

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (append), `apps/desktop/src/preload/index.ts` (append), `apps/desktop/src/main/ipc/register-ipc.ts` (spread one more group), `apps/desktop/src/main/ipc/validate.ts` (add `rejectArguments`)
- Create: `apps/desktop/src/main/ipc/update-handlers.ts`
- Test: `apps/desktop/test/update-handlers.test.ts`, `apps/desktop/test/ipc-validate.test.ts`

**Interfaces:**
- Invoke: `getUpdateStatus(): Promise<UpdateStatus>` (`updates:status`), `checkForUpdates(): Promise<UpdateStatus>` (`updates:check`), `installUpdate(): Promise<InstallOutcome>` (`updates:install`), `openUpdateDownload(): Promise<void>` (`updates:open-download`, opens `RELEASES_URL` only).
- Event: `'update-status-changed': UpdateStatus` (`updates:status-changed`).
- `function rejectArguments(args: readonly unknown[]): void` throws `IpcValidationError('Unexpected arguments')` when non-empty.
- `updateHandlers({ updates: Pick<UpdateService, 'status' | 'check' | 'install'>, openUrl(url: string): Promise<void> })`.

- [ ] Step 1: failing tests: handlers return service results with a real `UpdateService` + `FakeAppUpdater`; any handler called with an argument rejects with `IpcValidationError`; `openUpdateDownload` opens exactly `RELEASES_URL`.
- [ ] Step 2-4: FAIL, implement, PASS.
- [ ] Step 5: commit `feat(desktop): update IPC with argument validation`.

### Task 5: Wiring, tray item, packaging exclusion

**Files:**
- Create: `apps/desktop/src/main/app/update-wiring.ts`
- Modify: `compose.ts` (create service after the coordinator, add to IPC deps, tray deps, disposers, e2e hooks), `e2e-hooks.ts` (optional `updater`), `session/session-coordinator.ts` (`isDictating(): boolean` = sessions pending), `tray/tray-menu-template.ts` (optional `readyUpdate: string | null` in model, `installUpdate()` action), `tray/tray-menu.ts` (optional `updates` dep), `electron-builder.yml` (`'!out/main/fake-app-updater-*.js'`, `publish.updaterCacheDirName: codevo-whisper-updater`)
- Test: `tray-menu-template.test.ts`, `session-coordinator.test.ts`

**Interfaces:**
- `createUpdates(deps: { e2e: boolean; dictation: DictationGuard; send(status: UpdateStatus): void; logger: Logger }): Promise<{ service: UpdateService; fake: AppUpdater | null; dispose(): void }>`; e2e -> dynamic `import('../updates/fake-app-updater')`, mode from `CW_E2E_UPDATE_MODE` (`manual`) else `in-app`; otherwise `resolveUpdateMode` and, only for a non-`unsupported` mode, dynamic `import('electron-updater')`.
- Tray item `Reštartovať a aktualizovať na ${version}` right after the status line when `readyUpdate !== null`.

- [ ] Step 1: failing tests: tray template with `readyUpdate: '1.2.0'` lists the item after the status and its click calls `installUpdate`; without it the existing order is unchanged; `coordinator.isDictating()` true while recording and while transcribing, false after insert.
- [ ] Step 2-4: FAIL, implement, PASS. Build (`pnpm --filter @codevo-whisper/desktop exec electron-vite build`) and check that `out/main` has a `fake-app-updater-*.js` chunk and that electron-updater is bundled (no bare `electron-updater` import left in `out/main`).
- [ ] Step 5: commit `feat(desktop): wire the update service, tray install item, exclude the fake updater from packages`.

### Task 6: Settings row and e2e

**Files:**
- Create: `apps/desktop/src/renderer/settings/UpdateRow.tsx`, `apps/desktop/src/renderer/settings/update-row.ts`, `apps/desktop/src/renderer/settings/use-update-status.ts`, `apps/desktop/e2e/updates.spec.ts`
- Modify: `SystemSection.tsx` (render `<UpdateRow />` first), `e2e/launch-app.ts` (option `updateMode`)
- Test: `apps/desktop/test/update-row.test.ts`

**Interfaces:**
- `updateRowView(status: UpdateStatus, notice: InstallOutcome | null): { description: string; check: { visible: boolean; enabled: boolean }; install: boolean; download: boolean }`.
- Copy: idle `Verzia X. Aktualizácie sa kontrolujú automaticky.` / checked `Verzia X je najnovšia.`; checking `Verzia X. Hľadám aktualizácie…`; downloading `Sťahujem verziu Y… N %`; available (manual) `Je dostupná verzia Y. Stiahnite ju z GitHubu.`; ready `Verzia Y je pripravená. Nainštaluje sa po reštarte.`; installing `Reštartujem a inštalujem verziu Y…`; errors `Aktualizácie sa nepodarilo skontrolovať.` / `Aktualizáciu sa nepodarilo stiahnuť.` / `Aktualizáciu sa nepodarilo nainštalovať. Zostáva verzia X.`; unsupported `Verzia X. Aktualizácie fungujú iba v nainštalovanej aplikácii.`; `dictation-active` notice `Najprv dokončite diktovanie.` Buttons `Skontrolovať aktualizácie`, `Reštartovať a aktualizovať` (primary), `Stiahnuť z GitHubu`.

- [ ] Step 1: failing unit tests for `updateRowView` covering each phase and mode; e2e: fake publishes `9.9.9`, click check -> ready text, click install -> `installs === 1` and installing text; fake check failure -> error text; `updateMode: 'manual'` -> available text and download button.
- [ ] Step 2-4: FAIL, implement, PASS (`pnpm --filter @codevo-whisper/desktop test:e2e -- updates.spec.ts`).
- [ ] Step 5: commit `feat(desktop): Aktualizácie row in Nastavenia > Systém`.

### Task 7: Warm-up after update, docs, report

**Files:**
- Modify: `apps/desktop/test/warm-up-after-update.test.ts` (case: stamp from the previous release on disk -> warm-up runs once for the new version), `docs/operations/release.md` (N -> N+1 procedure with final fuses, replace the "Not covered yet" line), `README.md` if it mentions updates
- Create: `docs/reports/2026-10-26-auto-update-report.md`

- [ ] Step 1: add the warm-up test, run, PASS (behaviour exists).
- [ ] Step 2: document the N -> N+1 procedure: release N and N+1 via the pipeline, install N from the quarantined DMG, launch with `env -u ELECTRON_RUN_AS_NODE open`, wait for the background check (or click Skontrolovať), verify download, tray item, refusal while dictating, restart into N+1, fuses on the installed N+1, warm-up stamp, negative checks, Intel run, AppImage later.
- [ ] Step 3: full `pnpm lint`, `pnpm typecheck`, `pnpm test`, full e2e suite, `coderabbit review --agent --base main`, fix valid findings, write the report, commit.
