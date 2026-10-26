# Stream J report: capture flake

Branch `capture-flake` (from main `bec621b`). Plan: `docs/plans/2026-10-26-capture-flake.md`.

## Verdict

The flake in `capture.spec.ts` "records 16 kHz PCM16 ..." was caused by a real product bug, not by the test's timing. The bug also cut the start of every recording in the real app.

## Root cause

The capture AudioContext (`renderer/capture/microphone-session.ts`) rendered into the default audio **output** device. The AudioWorklet's `process()` only runs while that device renders. `context.resume()`, and with it `start()`, resolved before the output device actually started, and `MediaStreamAudioSourceNode` dropped the microphone audio from before that point.

- First recording in a fresh capture window: one `process()` call, then the context clock stalls for about 125 ms.
- Every later recording: the previous context was closed, so the output device is reopened. The first `process()` arrives 290-380 ms after `resume()`, and about 430 ms of audio is missing.
- Under CPU load: the output device sometimes did not start within 1 s at all. A recording came back with 0-6 ms of audio, which is the "0 bytes" and "1 level" flake.

The old test hid the bug. It measured the expected bytes from the first level event (`firstAudioAt`) instead of from `start()`. It only failed when the output device started so late that fewer than 10 levels arrived.

Evidence: temporary instrumentation (timestamps for getUserMedia, AudioContext, addModule, resume, the first worklet `process()`, the first level and the recorded bytes), run cold and warm, idle and under an 18-process CPU stress (load average 13-25). The instrumentation was not committed. Changing only the AudioContext options removed the gap. Nothing else changed between the two measurements.

## Fix

`new AudioContext({ sinkId: { type: 'none' } })`: the context has no output device and renders through a silent sink, which starts together with the context. The graph is the same as before, and the meter uses the same path. Capture no longer depends on the speakers or headphones; for example, a Bluetooth output no longer has to wake up for every dictation. The TS 6 DOM lib lacks `sinkId`, so the option object has a typed intersection. Electron 45 (Chromium 110+) supports it.

## Measurements of the sinkless fix (fake media device, median, n = 3-38 per row)

"Missing" means the audio lost between `start()` resolving and `stop()`. "To first sample" means from calling `start()` until the first sample that ends up in the recording.

| case | before: missing | before: to first sample | after: missing | after: to first sample |
|---|---|---|---|---|
| cold, no capture window yet (first dictation after launch) | 134 ms (idle), 192 ms, max 1003 ms (stress) | ~340 ms | 12 ms (idle), 9 ms (stress) | ~215 ms |
| cold, capture window loaded (what the old test measured) | 125 ms, max 995 ms (idle); 126-263 ms (stress) | ~180 ms | 12 ms (idle), 3 ms (stress) | ~63 ms |
| warm (every later dictation) | 427 ms (288-490) idle, 398 ms (stress) | ~465 ms | 3 ms (idle), 4 ms (stress) | ~25 ms |

The earlier numbers "170 ms warm / 455 ms cold" (formerly in spec section 5, line 119; now replaced) were the cold-window case and the warm case swapped: a warm start was the slow one.

## Can the first ~200 ms of speech be lost in the real app?

Before the fix: yes. The overlay switches to recording immediately (`DictationSession.begin`), but every dictation after the first lost about 0.45 s at the start. The first dictation after launch lost about 0.35 s, and under load the whole recording could be lost.

After the sinkless context alone, the first dictation after launch still lost about 210 ms, about 150 ms of which went to creating and loading the hidden capture window on the first microphone request. The pre-warm (see below) removes that.

After both changes, measured from the start request with the hotkey pressed 2 s after launch (n = 5 each):

| | before pre-warm | after pre-warm |
|---|---|---|
| first dictation after launch, idle | 208 ms (196-229) | 59 ms (52-62) |
| first dictation after launch, CPU stress | 289 ms (260-404) | 74 ms (68-87) |
| later dictations | ~25 ms | ~25 ms |

So with the fake device, at most about 60-75 ms is lost on the first dictation and about 25 ms on later ones. Real microphones can add their own start time to getUserMedia, especially Bluetooth inputs. The fake device cannot show that, and this stream did not open a real microphone.

## Pre-warming the capture window (review follow-up)

- `CaptureHost.prewarm()`: `CaptureWindow` reuses `ensure()`, which only creates the hidden window and loads `capture.html`. getUserMedia and the AudioContext are still created only by a `start` command (recording or meter), so the microphone stays closed (spec 5.5).
- `prewarmWhenShown(mainWindow, captureWindow)` (`src/main/audio/capture-prewarm.ts`) pre-warms once, the first time the main window is active on screen (`onActivityChange(true)`, which fires on `show`), so the capture window is always created after the main window. `compose.ts` changed by one disposer line plus the import.
- A bug found on the way: when a test quit right after launch, the main window's `show` could still fire during `app.quit()`. The pre-warm then created a BrowserWindow after Electron had closed all windows, and `app.close()` hung (settings.spec, about 1 in 6 runs). The same could happen if a microphone request arrived during quit. `CaptureWindow` no longer creates a window after `before-quit`: requests reject with "The app is quitting", and the pre-warm skips quietly. The repro then passed 30/30.
- The capture page's `devicechange` listener starts Chromium's Audio Service utility process (device monitoring only, no input stream and no mic indicator). After the first dictation this already happened before. The e2e therefore counts live `AudioContext` and `MediaStream` objects in the page via CDP `Runtime.queryObjects`: 0 and 0 after the pre-warm, 1 and 1 while the meter runs (positive control).
- `e2e/app-windows.ts` `appWindows(app)` drops the capture page for the window counts in `launch.spec.ts` and `settings.spec.ts`. `app.firstWindow()` stays the main window in every spec (full suite green). On Linux and Windows, closing the main window before any dictation now keeps the app running, as it already did after a first dictation. That matches the tray behaviour.

## 60 s recording check (review follow-up)

`e2e/capture-long.spec.ts` is skipped by default. Run it with `CW_E2E_LONG=1 pnpm --filter @codevo-whisper/desktop test:e2e e2e/capture-long.spec.ts` (also in the README). It records 60 s and asserts:
- bytes >= (stop - start resolved - 100 ms) x 32, and bytes <= (stop resolved - start called + 100 ms) x 32;
- every frame arrival lags the wall clock by at most 400 ms;
- every frame arrival is never ahead of it.

| run | missing over 60 s | max lag at a frame arrival |
|---|---|---|
| 18-process CPU stress, load average up to 68, run 1 | 3.3 ms | 13.8 ms |
| same, run 2 | 8.2 ms | 13.7 ms |
| without my stress (load average ~57 from other agents) | 10.6 ms | 14.5 ms |

The timer-driven silent sink kept pace with the microphone: no gaps and no drift.

## Tests

- `capture.spec.ts` "records 16 kHz PCM16 from the moment start resolves and releases the microphone": bytes >= (stop - start-resolved - 100 ms) x 32, bytes <= (stop-resolved - start-called + 100 ms) x 32, and the level count equals floor(recorded ms / 50) +- 2. The level count is now tied to the recorded audio instead of a fixed ">= 10". Timing uses `performance.now()` (CodeRabbit).
- New: "a recording right after another one also records from the moment start resolves". This is the warm case, which failed decisively before the fix (17 090 of >= 28 864 bytes).
- Both tests failed before the fix and pass after it. The capture spec with `--repeat-each 6` right after a fresh build under the 18-process CPU stress passed 48/48; the missing start was 2-13 ms against a 100 ms slack.
- Pre-warm: `test/capture-prewarm.test.ts` (3 tests) and the capture e2e "loads the capture page once the main window is shown, without opening the microphone" both failed before the change.
- Final checks: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 1064 passed and 1 skipped. Full desktop e2e right after a fresh build: 52 passed and 1 skipped (the opt-in 60 s check) at load average about 15, without stealing focus.
- CodeRabbit: first round 1 finding (use a monotonic clock in the test helper), fixed. The second round after the follow-ups: see the end of this report.

## Deviations

- No vitest unit test: the change is one AudioContext option whose effect only shows in a real Chromium audio graph, so the e2e tests are the regression tests.
- No pre-roll buffer and no warm microphone stream: spec 5.5 keeps the microphone closed outside of recording, and the "Rýchlejší štart" setting is a separate future option.

## Open items

- Measure getUserMedia start time with a real built-in and a Bluetooth microphone in a manual check.
- The spec latency sentence (section 5, line 119) now has the measured numbers.
