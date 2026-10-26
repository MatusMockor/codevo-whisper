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

## Measurements (fake media device, median, n = 3-38 per row)

"Missing" means the audio lost between `start()` resolving and `stop()`. "To first sample" means from calling `start()` until the first sample that ends up in the recording.

| case | before: missing | before: to first sample | after: missing | after: to first sample |
|---|---|---|---|---|
| cold, no capture window yet (first dictation after launch) | 134 ms (idle), 192 ms, max 1003 ms (stress) | ~340 ms | 12 ms (idle), 9 ms (stress) | ~215 ms |
| cold, capture window loaded (what the old test measured) | 125 ms, max 995 ms (idle); 126-263 ms (stress) | ~180 ms | 12 ms (idle), 3 ms (stress) | ~63 ms |
| warm (every later dictation) | 427 ms (288-490) idle, 398 ms (stress) | ~465 ms | 3 ms (idle), 4 ms (stress) | ~25 ms |

The earlier numbers "170 ms warm / 455 ms cold" (also in spec section 5, line 119) were the cold-window case and the warm case swapped: a warm start was the slow one.

## Can the first ~200 ms of speech be lost in the real app?

Before the fix: yes. The overlay switches to recording immediately (`DictationSession.begin`), but every dictation after the first lost about 0.45 s at the start. The first dictation after launch lost about 0.35 s, and under load the whole recording could be lost.

After the fix: later dictations lose about 25 ms (two IPC round trips, getUserMedia, AudioContext). The first dictation after launch still loses about 215 ms. Roughly 150 ms of that is creating and loading the hidden capture window, which happens lazily on the first microphone request. Real microphones can add their own start time to getUserMedia, especially Bluetooth inputs. The fake device cannot show that, and this stream did not open a real microphone.

## Tests

- `capture.spec.ts` "records 16 kHz PCM16 from the moment start resolves and releases the microphone": bytes >= (stop - start-resolved - 100 ms) x 32, bytes <= (stop-resolved - start-called + 100 ms) x 32, and the level count equals floor(recorded ms / 50) +- 2. The level count is now tied to the recorded audio instead of a fixed ">= 10". Timing uses `performance.now()` (CodeRabbit).
- New: "a recording right after another one also records from the moment start resolves". This is the warm case, which failed decisively before the fix (17 090 of >= 28 864 bytes).
- Both tests failed before the fix and pass after it. The capture spec with `--repeat-each 6` right after a fresh build under the 18-process CPU stress passed 48/48; the missing start was 2-13 ms against a 100 ms slack.
- `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 1061 passed and 1 skipped. Full desktop e2e right after a fresh build: 51/51 at load average about 12.8, without stealing focus.
- CodeRabbit: 1 finding (use a monotonic clock in the test helper), fixed.

## Deviations

- No vitest unit test: the change is one AudioContext option whose effect only shows in a real Chromium audio graph, so the e2e tests are the regression tests.
- No pre-roll buffer and no warm microphone stream: spec 5.5 keeps the microphone closed outside of recording, and the "Rýchlejší štart" setting is a separate future option.

## Open items

- Pre-warming the capture window (not the microphone) at launch would cut about 150 ms from the first dictation after launch. It was not done here because it touches `compose.ts`/startup (shared with other streams). It also breaks `launch.spec.ts` and `settings.spec.ts`, which assert `app.windows()` has length 1, and `app.firstWindow()` in every spec if the capture window opened before the main window. The controller should decide on it.
- Spec section 5 (line 119) still quotes the old latency numbers ("170 ms, 455 ms on the first recording"); they should be updated to the numbers above.
- Measure getUserMedia start time with a real built-in and a Bluetooth microphone in a manual check.
