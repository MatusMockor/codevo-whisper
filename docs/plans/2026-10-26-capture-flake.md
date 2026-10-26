# Capture flake (stream J) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recordings contain the audio from the moment `start()` resolves, on every recording and under load, and the capture e2e checks exactly that without wall-clock fragility.

**Architecture:** The root cause is that the capture AudioContext renders into the default audio output device. Its clock (and so the AudioWorklet `process()` calls) only starts when the output device runs, while `resume()` already resolves earlier: about 130 ms on the first recording, 300-450 ms on every later one (the output device is reopened after `close()`), and under CPU load sometimes not within 1 s at all (0 bytes). Microphone audio from before that is dropped. The fix is an AudioContext without an output sink (`sinkId: { type: 'none' }`), so the graph is driven by a silent sink that starts with the context.

**Tech Stack:** Electron 45 (Chromium AudioContext `sinkId`), AudioWorklet, Playwright Electron e2e.

**Spec:** docs/specs/2026-10-25-codevo-whisper-design.md (5.5: the microphone is open only while recording, no warm stream by default)

## Global Constraints

- The microphone is opened only while recording (push-to-talk), never kept open in the background (spec 5.5). No pre-roll buffer and no warm stream.
- PCM16 16 kHz mono, 32 bytes per ms, levels every 50 ms, frames of 100 ms.
- No code comments, guard clauses, never else.

## Review Focus

- Second and later recordings in one app session: they must not lose their start (pinned by the new e2e test in Task 1).
- Heavy CPU load right after launch: the first recording must not come back empty (Task 1 test, verified under a CPU stress run).
- Meter mode uses the same session code: the meter test must stay green.
- A Chromium that ignores `sinkId` would fall back to the output device (old behaviour, not a crash); Electron is pinned, so no runtime branch.
- Upper bound: a recording must never hold more audio than the wall-clock time it ran (Task 1 asserts it).

---

### Task 1: Capture clocked by the microphone, not the speakers

**Files:**
- Modify: `apps/desktop/src/renderer/capture/microphone-session.ts` (AudioContext creation)
- Test: `apps/desktop/e2e/capture.spec.ts`

**Interfaces:**
- Produces: `new AudioContext(SINKLESS_CONTEXT)` where `SINKLESS_CONTEXT: AudioContextOptions & { sinkId: { type: 'none' } }` (lib.dom in TS 6 lacks `sinkId`).

- [ ] **Step 1: Rewrite the failing test** `records 16 kHz PCM16 from the moment start resolves and releases the microphone`: take `startedAt` after `start()` resolves, `stoppedAt` before `stop()`, `settledAt` after. Assert `bytes >= (stoppedAt - startedAt - START_SLACK_MS) * 32` with `START_SLACK_MS = 100`, `bytes <= (settledAt - calledAt + 100) * 32`, `bytes % 2 === 0`, and the level count matches the recorded audio (`|levels - floor(recordedMs / 50)| <= 2`) instead of a fixed `>= 10`. Drop the `firstAudioAt` compensation.
- [ ] **Step 2: Add the failing test** `a recording right after another one also records from the moment start resolves`: one 300 ms recording, then a 1 s recording with the same lower bound.
- [ ] **Step 3: Run** `env -u ELECTRON_RUN_AS_NODE pnpm exec playwright test e2e/capture.spec.ts` after `pnpm exec electron-vite build`. Expected: both tests FAIL (about 130 ms and 450 ms of audio missing).
- [ ] **Step 4: Create the AudioContext with `SINKLESS_CONTEXT`** in `MicrophoneSession.open`.
- [ ] **Step 5: Run** the capture spec (pass), the capture spec with `--repeat-each 5` under an 18-process CPU stress (pass), `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- [ ] **Step 6: Commit** `fix(desktop): clock the capture by the microphone, not the audio output device`.

### Task 2: Report

- [ ] Write `docs/reports/2026-10-26-capture-flake-report.md` with the before/after start-to-first-sample latency (cold without window, cold with window, warm; idle and under stress), the answer whether the first ~200 ms of speech is lost, and the open item (pre-warming the capture window for the first recording after launch). Run the full desktop e2e and CodeRabbit, commit.

## Review follow-ups (controller, after the first review)

### Task 3: Rename the upper bound slack to `END_SLACK_MS` in `capture.spec.ts`

### Task 4: Prepare the capture window once the main window is shown

- `CaptureHost.prewarm(): void` (CaptureWindow reuses `ensure()`, only loads the page), `prewarmWhenShown(window: WindowActivity, host: Pick<CaptureHost, 'prewarm'>): () => void` in `src/main/audio/capture-prewarm.ts`, prewarms once on the first `onActivityChange(true)`. Wired in `compose.ts` (one disposer line).
- Failing tests first: `test/capture-prewarm.test.ts`; capture e2e "loads the capture page once the main window is shown, without opening the microphone" (0 AudioContext and 0 MediaStream objects in the page, 1 and 1 while the meter runs). `e2e/app-windows.ts` `appWindows(app)` without the capture page for the window counts in `launch.spec.ts` and `settings.spec.ts`.
- Measure the first dictation after launch before and after.

### Task 5: Opt-in 60 s capture check

- `e2e/capture-long.spec.ts`, skipped unless `CW_E2E_LONG=1`: bytes against wall time (start and end slack 100 ms), frame arrival lag at most 400 ms, never ahead of the wall clock. Run under CPU stress; documented in README.

### Task 6: Spec latency figures, report update
