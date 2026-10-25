# Stream H - auto-update report

Branch `auto-update`. Plan: `docs/plans/2026-10-26-auto-update.md`. Spec: sections 3 (UpdateService), 7 (warm-up after update), 10 (release); `docs/spikes/signed-update.md`.

## What was built

`apps/desktop/src/main/updates/`:

| file | responsibility |
|---|---|
| `app-updater.ts` | `AppUpdater` adapter interface: `check()`, `download(onProgress)`, `install()` |
| `update-service.ts` | `UpdateService` state machine `idle(checked) / checking / available / downloading(percent) / ready / installing / error(check, download, install)`; one check at a time; background check failures keep the previous phase and are only logged; install refused unless `ready` + in-app mode and refused during a dictation |
| `electron-updater-adapter.ts` | wraps electron-updater (third-party boundary): `autoDownload = false`, `autoInstallOnAppQuit = false`, `allowDowngrade = false`, updater log routed to the app logger, permanent `error` listener (an unhandled `error` event from the native updater would otherwise crash the main process), `install()` = `quitAndInstall(false, true)`, rejects on the next `error` or after 2 minutes without a restart |
| `load-electron-updater.ts` | loads the adapter; a load failure is logged and the app falls back to `unsupported` instead of failing startup |
| `update-scheduler.ts` | first background check 30 s after start, then every 6 h |
| `update-policy.ts` | Strategy per platform behind `PlatformUpdatePolicy`: packaged macOS and AppImage (`APPIMAGE`) in-app, other Linux packages (deb) `manual`, unpackaged and other platforms `unsupported` |
| `dictation-guard.ts`, `coordinator-dictation-guard.ts` | `isDictating()` (new `SessionCoordinator.isDictating()`: recording, transcribing or inserting) and `suspend()` (pauses the hotkey for the restart, resumes on failure, keeps a user's own pause) |
| `fake-app-updater.ts` | fake for unit tests and e2e mode (dynamic import, excluded from packages) |

Wiring: `app/update-wiring.ts` (`createUpdates`), additive lines in `compose.ts`, `e2e-hooks.ts` (`updater`, `loadUpdater`), `register-ipc.ts`, `ipc-contract.ts`, `preload/index.ts`.

IPC: `getUpdateStatus`, `checkForUpdates`, `installUpdate` (`restarting | dictation-active | not-ready`), `openUpdateDownload` (opens only the fixed `https://github.com/MatusMockor/codevo-whisper/releases/latest`), event `update-status-changed`. Every update handler rejects calls with arguments (`rejectArguments`).

UI: Nastavenia > Systém row "Aktualizácie" (`UpdateRow.tsx`, copy in `update-row.ts`): current version, "Skontrolovať aktualizácie", status and progress, "Reštartovať a aktualizovať" when ready, "Stiahnuť z GitHubu" in manual mode, "Najprv dokončite diktovanie, potom aplikáciu reštartujte." when the restart is refused. Tray: "Reštartovať a aktualizovať na X" right after the status line when an update is ready.

Packaging: electron-updater 6.8.11 is a devDependency bundled by electron-vite into `out/main` (no `node_modules` in the package, same as React). `electron-builder.yml` excludes `out/main/fake-app-updater-*.js`.

Docs: `docs/operations/release.md` sections "In-app update" and "N -> N+1 update verification (manual, release-blocking)" (preparation, 10 steps with the final fuses, refusal during a dictation, no install on a normal quit, TCC grants kept, warm-up stamp, logs, negative checks, results table, Linux); README section "Updates".

## Decision: auto-download, explicit install

The download starts as soon as a check finds an update; installing needs the user's click. This means one user action instead of two, and the tray item appears without the user opening Nastavenia. It is still safe: with `autoInstallOnAppQuit = false`, `MacUpdater` does not hand the file to Squirrel.Mac after the download, so a normal quit never installs. Only `quitAndInstall()` feeds Squirrel, which also checks Team ID / bundle ID. The cost is one ZIP (about 100-150 MB) per release in the background. In manual mode (deb) nothing is downloaded.

## Tests

- New unit tests: `update-policy`, `update-service` (15 cases including concurrent checks, background failure, refusal during a dictation, install failure resumes dictation), `electron-updater-adapter` (flags, logging, progress listener cleanup, install error and 2 minute timeout, unhandled `error`, load fallback), `update-scheduler` (fake timers), `update-handlers` (real service + fake), `ipc-validate` (`rejectArguments`), `update-row` (every phase and mode), `tray-menu-template` (update item), `session-coordinator` (`isDictating`, dictation guard with the real coordinator), `packaging-config` (every dynamically imported fake is excluded in `electron-builder.yml`, GitHub publish config), `warm-up-after-update` (first start after an update from the previous release's stamp).
- e2e `e2e/updates.spec.ts` (4 tests): download with progress, ready, restart only after the click, install failure; up to date and failed check; manual mode with the download button and no download; the real bundled electron-updater loads in Electron and stays inactive unpackaged.
- `pnpm lint`, `pnpm typecheck` 0 errors; `pnpm test` 124 files, 923 passed, 1 skipped (the existing real-model test). Full desktop e2e: 46 passed in 5 of 7 runs. The other two runs each had one failure that did not come back: once a capture test (`capture.spec.ts`, fake media delivered 0 bytes; not touched by this stream), and once `app.close()` timed out in the `afterEach` of the electron-updater load test. That spec passed 32/32 with `--repeat-each 8` and in the later full runs.
- Packaging smoke (unsigned, `--mac zip --arm64`, temp output, placeholder binaries removed afterwards): `app.asar` contains `out/main/index.js` and the electron-updater chunk, no fake chunk and no `node_modules`; `app-update.yml` has `provider: github`, `owner: MatusMockor`, `repo: codevo-whisper`.

## Deviations

- `publish.updaterCacheDirName` was added and then removed: electron-builder 26.18 always overwrites it with the name derived from the package (`PublishManager.getAppUpdatePublishConfiguration`), so the cache stays `@codevo-whisperdesktop-updater` (documented in release.md).
- No separate "download" IPC: the service downloads by itself (decision above). A failed download is retried with "Skontrolovať aktualizácie".
- Linux: `manual` covers every non-AppImage package. A non-deb, non-AppImage install falls back to electron-updater's AppImage updater, which is inactive without `APPIMAGE`, so it reports nothing.
- The plan placed the row first in Systém; it is the last row (smaller diff for the shared section).
- IPC and wiring landed in one commit so typecheck stayed green after every commit.
- The e2e hooks gained `loadUpdater`. Playwright's `evaluate` cannot run a dynamic `import()`, so this is the only way to load the real bundled updater in e2e. It exists only in e2e mode.

## Open items

- N -> N+1 verification with the final fuses is documented but not run: it needs two published releases (and accepted notarization). That includes checking that Squirrel still installs when `before-quit` is held by the QuitGate, and the install timeout on a real machine.
- The tray item cannot show the "dictation active" refusal; it only logs it (the settings row shows it).
- An app started from the mounted DMG or a translocated path will fail at install time with the generic install error; there is no special message for it.
- CodeRabbit: the first run had 1 finding (an updater load failure could stop app startup). It was valid and is fixed in `a5c467a`. Three later attempts, which would have covered the last two fix commits, were rate-limited (free tier: all 3 included reviews used).
- Recommended: a second-model review (gpt-6.1-sol) of the install path, because the quit/relaunch behaviour cannot be verified until real releases exist.

## Review fixes

Round after the gpt-6.1-sol security review and the Claude review. Commits `2e99387`, `be8048f`, `14387d8`, `6513b3b`.

1. Downgrade through a compromised release: `mac.extendInfo.ElectronSquirrelPreventDowngrades: true` (key confirmed in Electron 45's `Squirrel.framework`). Squirrel.Mac now compares the versions of the signed bundles. `packaging-config.test.ts` asserts the key in `mac.extendInfo`. An unsigned packaging smoke showed it in the built `Info.plist` (`true`, `CFBundleShortVersionString` = `CFBundleVersion` = build version). release.md has the negative check "higher manifest + older signed bundle is rejected" (needs a release N-1 that already shipped the key).
2. Install timeout: removed from the adapter. A new phase `stalled` (after 2 minutes without a restart or an error) asks for a manual restart ("Inštalácia verzie X sa nedokončila. Ukončite Codevo Whisper a spustite ho znova.") and keeps dictation paused. Only a real updater `error` resumes dictation. The tray pause item is disabled, and `TrayMenu.togglePause` refuses, while an install is in progress or stalled. Test: three failed attempts leave the `error` listener count at its baseline. Not fixable here: MacUpdater adds a native `update-downloaded` listener on every `quitAndInstall` before Squirrel has the file (upstream code). Retries only happen after a real error.
3. Before `quitAndInstall`: `coordinatorDictationGuard` pauses the hotkey, blocks new capture requests (`WindowAudioCapture.block()`: `start` and `startMeter` reject), stops the settings meter through `MicrophoneSettings.stopMeter()` and waits up to 2 s for in-flight capture (`settleWithin`, now exported from `quit-gate.ts`). After that the adapter is called. `UpdateService.install()` is now async and shows `installing` right away, so a second click is refused.
4. Linux: `PlatformFacts.packageType` (`readPackageType(process.resourcesPath)`). Any package type means `manual`, also with `APPIMAGE` set. The adapter gets `installable: mode === 'in-app'` and rejects `download` / `install` otherwise.
5. Redirects: pnpm patches `patches/builder-util-runtime@9.7.0.patch` (every hop is `redirectCount + 1` in the API and download paths, limit checked with `>=`, `prepareRedirectUrlOptions` throws on HTTPS -> HTTP and the download path catches it) and `patches/electron-updater@6.8.11.patch` (Electron `redirect` handler: same limit, catches the refusal and rejects). `updater-redirects.test.ts` runs the patched HttpExecutor against a local redirect-loop server. Before the patch the loop exhausted local ports (`EADDRNOTAVAIL`). It also covers 3 hops still followed and the HTTPS -> HTTP refusal while HTTPS cross-host (GitHub CDN) and HTTP -> HTTPS still work. The bundled `out/main` chunk contains the patched code. The adapter also has deadlines: check 60 s, download 60 min (cancels through electron-updater's `CancellationToken`).
6. A user check that joins a running background check now reports its failure (the run's origin is raised to `user`).
7. e2e mode starts no background scheduler; `checks` counts are deterministic.
8. Before the install the adapter takes the `downloadedFile` from `update-downloaded` and the sha512 of the matching manifest entry from the check (by file name). `verify-download.ts` then checks the file: it re-hashes it (O_NOFOLLOW, same inode as `lstat`) and requires the pending dir and the cache dir to be real directories owned by the user (no symlinks). Both dirs are set to 0700. A replaced, symlinked or missing file refuses the install.
9. `Logger.warn` added (console and `RecordingLogger`). electron-updater warnings and its internal error log go to `warn`. The adapter logs an `error` event only when no call is waiting for it, and the service logs call failures, so each failure is logged once.
10. `createUpdates` is synchronous. electron-updater loads through `LazyAppUpdater` on the first check (if the load fails, the call fails and the next call loads again), so it no longer runs before `registerIpc`. `TrayMenuDeps.updates` is required. The e2e hook `updater` is now a promise of the fake.
11. Copy: "Verzia X je pripravená. Po dokončení diktovania to skúste znova." and tray "Reštartovať a aktualizovať na verziu X".

Optional e2e with `forceDevUpdateConfig` and a local generic feed: not done. On macOS the download path calls Squirrel's `setFeedURL`, which needs a signed app, so an unsigned dev Electron cannot exercise it end to end. The sha512 re-check and the redirect patch are covered by unit tests on real files and a real HTTP server.

Verification after the fixes:
- `pnpm lint`, `pnpm typecheck`: 0 errors. `pnpm test`: 128 files, 948 passed, 1 skipped.
- Full e2e: 45 passed, 1 failed (`capture.spec.ts` "records 16 kHz PCM16 …", the same flake as in the first round, which also happened at `39a9686` before this round touched capture code). The spec alone with `--repeat-each 5`: 35/35. `updates.spec.ts`: 4/4.
- `14387d8` was amended once, before anything else was built on it, to fix a type import in the new test.
