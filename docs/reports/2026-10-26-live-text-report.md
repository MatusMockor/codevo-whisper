# Stream I - Živý text in the macOS app: report

Branch `live-text` (worktree `~/Developer/codevo-whisper-live`), based on `main` at `bec621b`. Plan: `docs/plans/2026-10-26-live-text.md`. Spec: `docs/specs/2026-10-25-codevo-whisper-design.md` sections 5.3, 5.4 and 6. Nothing pushed, nothing committed to `main`.

## What was built

| Area | Files (under `apps/desktop` unless noted) | Notes |
|---|---|---|
| Engine event contract | `src/main/engines/transcription-engine.ts` | `DictationOptions.onTranscript?(update)` is an event sink. `TranscriptUpdate` is `partial { segmentId, revision, text }`, `final { segmentId, text }` or `restart`. Engines call the sink; the session decides what to show. New failure reason `engine-failed` ("Prepis sa nepodaril"). |
| LocalEngine | `src/main/engines/local-engine.ts`, `local-dictation.ts`, `transcribe-cli-transcriber.ts` | One `TranscriptionDispatcher<LocalContext>` per engine. Its `TranscribeCliTranscriber` (a `SegmentTranscriber` over `runTranscribeCli`) honours the dispatcher's abort signal and has its own 60 s per-call timeout. Jobs under 640 bytes resolve `''` without spawning (the old `MIN_TAIL_BYTES` rule). `prepare()` resolves the model path once. Each dictation is a `LocalDictation` that wraps one `RollingSession` (`deviceId 'local'`, context `{ language, model }`, `partials` = Živý text). Abort cancels the session, which kills the running transcribe-cli. `SegmentFailedError` becomes `TranscriptionFailedError('engine-failed', textSoFar)`, so the text so far is kept and "Kopírovať doterajší text" is offered. Audio after key-up is ignored. `chunk-pcm.ts` and `buffered-dictation.ts` are removed. |
| RemoteEngine | `src/main/remote/remote-dictation.ts` | Partials of the dictation's own session go to the sink only in Živý text. Finals go to the sink in both modes. A partial with a segment id above 4095 is a protocol error. After a reconnect the dictation sends `restart` before replaying, so the overlay never mixes text from two attempts. `start.partials: true` with the one type assertion is unchanged (stream F reconciles the protocol type). |
| Live view model | `src/main/session/live-transcript.ts` | Per segment it keeps the final or the latest partial (stale revisions are ignored, a final drops its segment's partial, `restart` clears everything). Final words are confirmed. Partial words are confirmed when they match the same word position in the segment's previous partial (agreement of two consecutive hypotheses); the rest is tentative. Confirmed is the longest solid prefix. The view keeps the last 360 characters, cut at a word boundary. |
| Session | `src/main/session/dictation-session.ts`, `src/shared/overlay-contract.ts` | In Živý text the session subscribes to the sink and adds `live: { confirmed, tentative }` to the `recording` and `processing` states. In Indikátor it does not subscribe, so the states are unchanged. The engine is chosen before recording, the update guard (`isDictating`) is unchanged, and the cancel paths are unchanged. |
| Settings | `src/main/settings/settings-fields.ts`, `src/renderer/settings/DictationSection.tsx` | `overlay: 'live'` is valid in IPC and on load; Indikátor is still the default. The segment is enabled and the description is the mockup copy: "Živý text ukazuje prepis už počas hovorenia. Indikátor je diskrétnejší a prepis je rýchlejší." The now-unused `ComingSoon` component and `.soon` style were removed. |
| Overlay | `src/renderer/overlay/Overlay.tsx`, `overlay.css` | Per the mockup's Živý text tile: a 380 px panel, text above the bar (`.ov-text`: 15 px, line-height 1.45, at most 3 lines, top fade mask), confirmed words in `.w` and tentative words in `.w.t` (`--ov-ink-t`). It grows upward because the stage is bottom-aligned in the unchanged 420x168 window. Pill shape while there is no text, rounded card once text appears. Processing keeps the text. The window is untouched (non-focusable panel, `showInactive`). |
| packages/audio | `packages/audio/src/segmentation/segmenter.ts` | Bug fix found through the integration: a hard cut was placed at the end of the VAD frame. A segment that starts mid-frame (every segment after a pause cut) could therefore be up to one 20 ms frame longer than 25 s (seen: 400,160 samples). The cut is now at exactly `start + hardMs`. |

## Tests

- `test/local-dictation.test.ts` drives the real `TranscriptionDispatcher`, `RollingSession`, VAD, segmenter and assembler with a fake transcribe-cli. `test/support/fake-timeline-cli.js` is a node script: it locates the job's audio in a source PCM by a 16-sample key and returns one deterministic word per voiced 300 ms block (`timeline-words.js`, shared with the test helpers). Its inputs are the dithered `packages/audio` speech fixtures (`test/support/timeline-audio.ts`). It covers:
  - 60 s in Indikátor: no partials, 3 finals before key-up, exactly one job after key-up, all jobs <= 25 s, text equal to the timeline exactly once, finals join to the text, segment ids in order.
  - 30 s in Živý text: about 30 partials with increasing revisions per segment, no partial after its segment's final, finals in order.
  - Per-session language and model.
  - Cancel kills the hanging process and rejects within 1 s.
  - The per-call timeout fails the dictation with `engine-failed` and keeps the text so far.
  - Under 640 bytes and 30 s of silence make no call.
  - Audio after key-up is ignored.
- `test/local-engine.test.ts` now goes through `prepare/start/push/finish` (speech + 30 s silence + speech in <= 25 s jobs, language, backend, abort, already aborted, no model, Canary with `auto`).
- `test/remote-dictation-protocol.test.ts` (scripted responder) covers:
  - partials and finals of the own session in Živý text, with other sessions ignored;
  - finals only in Indikátor;
  - an oversized partial segment id is a protocol error.
- `test/remote-retry.test.ts` (real gateway + drop proxy): one `restart` before the replay, and the replayed finals join to the inserted text.
- `test/live-transcript.test.ts`: 11 cases for the view model.
- `test/session-coordinator.test.ts`, with the coordinator, LocalEngine and fake timeline CLI:
  - in Živý text every recording and processing state carries `live`, the last processing state shows the inserted text as confirmed, and the insertion is the joined finals;
  - in Indikátor no state has `live`.
  - The Živý text test fails against the old session.
- `test/ipc-validate.test.ts` and `settings-store.test.ts`: `live` is accepted and kept; unknown values are rejected or replaced.
- `e2e/overlay.spec.ts` (injected states): confirmed and tentative spans with different computed colours, the text above the bar, the bottom edge fixed while the panel grows upward, at most 3 lines, processing keeps the text, the fallback notice stays inside the window, and the panel stays non-focusable and unfocused.
- `e2e/settings.spec.ts`: Živý text can be chosen and is saved, the copy is right, and "Príde v ďalšej verzii" is gone. The pointer test now uses a disabled server radio as its disabled example.
- `packages/audio` `segmenter.test.ts`: hard cut after a pause cut that does not start on a frame boundary.
- Totals: `pnpm lint` and `pnpm typecheck` clean; `pnpm test` 1078 passed and 2 skipped (the existing skip plus the opt-in real-model file). Full desktop e2e: 52 passed and 1 failed: `capture.spec.ts` "records 16 kHz PCM16 ...", the known flake that stream J is investigating. That spec passed 7 of 7, twice, when rerun alone. No focus was stolen (accessory e2e mode, injected overlay states).

## Latency with the real model (this Mac)

`CW_REAL_MODEL=~/Library/Application Support/Codevo Whisper/models/parakeet-ultra-q8.gguf pnpm vitest run --project desktop test/local-engine.real.test.ts`. Setup: Apple M5 Pro, Metal, the bundled transcribe-cli (copied into the worktree's ignored `resources/bin`). The test streams audio in 100 ms frames at real-time pace and measures from `finish()` (key-up) to the final text. Inputs: the 40 s Slovak TTS excerpt of `spikes/rolling-latency/.data/speech16k.pcm` and the 7 s Slovak sample. Four runs:

| case | end of speech to final text |
|---|---|
| 40 s, Indikátor (2 finals committed while speaking) | 141, 180, 172, 167 ms |
| 40 s, Živý text (36-38 partials, about one per second) | 139, 169, 171, 166 ms |
| 7 s sample, Indikátor | 138, 162, 164, 164 ms |
| 7 s sample, Živý text (6 partials) | 139, 159, 163, 163 ms |
| old batch path, the same 40 s transcribed after key-up | 389, 385, 385, 385 ms |

- The spec target is end-of-speech-to-final p50 <= 1.0 s and p95 <= 1.3 s. The worst of 16 measurements is 180 ms.
- The text is identical in both modes, and the sample transcript is exact.
- Long dictations no longer grow the key-up wait, because committed segments are transcribed while the user speaks. The old path would wait for every 25 s chunk after key-up.

## Deviations and decisions

- **Event contract.** The spec's `partial`/`final` events are an `onTranscript` callback on `DictationOptions` rather than an emitter on the engine. A dictation's events belong to that dictation, and the callback needs no subscription bookkeeping. `restart` is an addition for the server retry.
- **"Confirmed" words in a partial.** The mockup shows only the last two or three words lighter. If finals alone counted as confirmed, the whole open segment (up to 25 s) would be light. So a partial word counts as confirmed once two consecutive partials agree on it. That word can still turn tentative if a later partial changes it. Finals are always solid.
- **Silence.** The packages/audio policy still applies:
  - a dictation with no cut is always sent once (a short silent press still costs one call and ends with "Nezachytila sa žiadna reč", as before);
  - silent segments after a cut are skipped, so long silences make no call (before, every 25 s chunk was transcribed).
- **Language check.** `prepare()` checks `language-required` against the settings. The old engine also re-checked when it transcribed. A language change between that check and the start of the dictation is not re-checked.
- **Per-call timeout** is 60 s locally (`LOCAL_CALL_TIMEOUT_MS`); before, it was transcribe-cli's 120 s default. Jobs are at most 25 s, and Intel CPU needs about 7 s for that.
- **packages/audio change.** One fix outside the desktop app (the hard-cut overshoot above), test-first, in its own commit.
- **Remote partials** are tested with the scripted responder only. Stream F's real gateway (which emits partials and owns the `start.partials` type) is not on this branch.
- **Test fake.** The fake transcribe-cli is a node script, not bash, because it locates job audio inside a source recording. It runs only in tests and needs `node` on `PATH`.

## Open items

- Partial latency (request to partial event) is not measured separately. One call on this Mac takes about 140-180 ms, and 36-38 partials over 40 s show a roughly 1 s cadence.
- The overlay waveform in the live panel is the existing Indikátor waveform; the mockup's live tile shows the same bar.
- After the merge with `main`: the type assertion in `RemoteDictation.startMessage` can go, because `main`'s `ClientMessage` has `partials`.
- `main` now has `ResidentTranscriber` in `packages/stt-runner` (stream F's resident worker). LocalEngine still spawns transcribe-cli per call, about 140-180 ms per call on this Mac. A resident local model would need the stt-worker built and signed for macOS; that is a separate task.

## Reviews and integration with main

- `main` moved on while this stream ran: stream F was merged in `d17cb9f`, with the integration report in `770f9b8`. As instructed, this branch is not merged with `main`, and the controller reconciles. Trial merge of `main` into this branch (`git merge --no-commit`, then aborted):
  - No conflicts.
  - Lint and typecheck were clean.
  - `pnpm test`: 1138 passed and 1 failed. The failure was the new restart test, because F's VAD gateway skips constant audio. Fixed in `99eea00` (the test now pushes voiced speech); it passes 3 of 3 on this branch and in the merged tree.
  - A throwaway test in the merged tree drove `RemoteEngine` in Živý text against F's real gateway (fake STT). It received `partial` revisions 1-4 for segment 0 and then the final, so remote Živý text works end to end after the merge.
- **gpt-6.1-sol** (`codex exec -m gpt-6.1-sol -s read-only`, `main..HEAD`) found 2 P1 and 2 P2 issues. All four describe the difference between this branch's base (`bec621b`) and the newer `main`, not changes made here:
  - P1: the base's protocol rejects `start.partials`;
  - P1: the base's gateway pauses the flow after 300 s;
  - P2: leftover partial jobs after completion are not cancelled (fixed on `main` in `a8fd62a`);
  - P2: remaining finals keep running after the first failure (fixed on `main` in `6de437b`).
  
  The merge brings in all four fixes, and the full suite was green in the trial merge after `99eea00`. Nothing to change on this branch.

## CodeRabbit

`coderabbit review --agent --base main` was rate-limited twice by the shared free-tier allowance (`rate_limit`, "You've used all 3 included reviews"; the repository has no Git remote, so no organization plan applies). On the coordinator's instruction no further retry was made; the controller runs CodeRabbit once on the whole repository at the end.
