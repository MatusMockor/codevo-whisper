# Phase 3 - Audio Segmentation Core Report

Date: 2026-10-25. Branch `phase-3-audio`. Plan: `docs/plans/2026-10-25-phase-3-audio-segmentation.md`. Spec: sections 5.3, 5.4, 6, 9.

## What was built

`packages/audio` (`@codevo-whisper/audio`), pure TypeScript with no I/O in `src/`. Time comes from an injected `Clock`. The engine is behind `SegmentTranscriber`.

| module | files | responsibility |
|---|---|---|
| PCM | `pcm/pcm-format.ts`, `pcm/pcm-buffer.ts` | PCM16 LE mono 16 kHz helpers. `PcmBuffer` uses absolute sample positions, carries an odd byte to the next chunk, returns copied slices and drops committed audio. |
| VAD | `vad/*` | `AdaptiveVad` (implements `VoiceActivityDetector`) on 20 ms frames (20-30 ms allowed). Noise floor = minimum and peak = maximum of frame energy over the last 3 s, seeded with a -60 dBFS prior. Onset at `floor + max(6 dB, 0.5 x range)`, release at `floor + max(3 dB, 0.4 x range)`. |
| Segmentation | `segmentation/*` | `PauseTracker` (pauses >= 200 ms), `selectCut` (midpoint of the longest pause, ties go to the later one), `Segmenter` (target 15 s, hard cut 25 s with 1 s overlap, 0.5 s pre-roll after a pause cut, `minSegmentMs` 10 s, `settledPauseMs` 500 ms). |
| Dedup | `dedup/*` | `removeBoundaryDuplicates` matches the longest suffix/prefix fuzzily: ignores case, diacritics and punctuation, allows edit distance 1 for words of 4+ letters and 2 for words of 7+. A single-word overlap only matches when the words differ in the ending (`zahodíme.`/`zahodím.` yes, `right`/`night` no). |
| Transcript | `transcript/*` | `TranscriptAssembler` handles segment ids (from 0), revisions per segment and finals released in order. Each final is deduped against the last non-empty final using `ceil(leadInMs / 250)` words. Late partials are dropped. `TranscriptEvent = { type: 'partial' \| 'final', segmentId, revision, text }`. |
| Partials | `partials/*` | `partialIntervalMs = clamp(activeDevices x max(1 s, EWMA(service) / 0.55), 1 s, 3 s)`. `PartialGate`: needs the interval elapsed, >= 0.5 s of tail and new voiced audio since the last request. |
| Scheduling | `scheduling/*` | `FairJobQueue`: finals before partials, round-robin per device in both classes, one pending partial per device. A partial is dropped when the device's partial is in flight or its final is pending or running. A final supersedes the device's pending partial. `TranscriptionDispatcher` (implements `JobSubmitter`, `DeviceRegistry`) runs one call at a time, feeds service times into the interval, aborts in-flight calls on `cancelDevice` and never rejects. |
| Session | `session/*` | `RollingSession` per dictation: `push(pcm)`, `finish(): Promise<string>`, `cancel()`. Partials only when `partials: true` (Živý text). Errors: `SegmentFailedError { segmentId, textSoFar, cause }` and `SessionCancelledError`. |

## Tests

- 19 test files, 129 tests in `packages/audio`. The whole repo has 444 passing tests (1 skipped, which already existed). `pnpm lint`, `pnpm typecheck` and `pnpm test` were green after every commit.
- Recorded fixtures (`test/fixtures`, 758 KB total) are cut from the phase 0 spike audio `spikes/rolling-latency/.data/speech16k.pcm` (aivora TTS, Slovak, PCM16 16 kHz):
  - `speech-pauses.pcm` covers 0.0-12.0 s and has sentence pauses near 6.9 s and 10.2 s.
  - `speech-continuous.pcm` covers 32.6-44.3 s and has no pause >= 200 ms.
- VAD tests cover the clean fixture and the fixture with white noise at -30 dBFS. At that noise level the spike's fixed threshold finds no pause and the adaptive floor still finds the sentence pauses. A recording that starts mid-speech produces no false pauses.
- Segmenter tests cover the synthetic policy edges and the fixtures: 3 x the pause fixture gives a pause commit, and 3 x the continuous fixture (35 s) gives a hard cut and an end segment, with every job <= 25 s.
- End-to-end tests drive the real dispatcher, VAD, segmenter and assembler with a fake engine. The fake (`TimelineTranscriber`) maps audio blocks to distinct words and alters the first word of every job that has a lead-in. The final text must equal the expected word sequence exactly once. With dedup turned off these tests fail, which shows the tests really depend on dedup.
- Session tests cover:
  - Indikátor mode makes no partial calls.
  - About one partial per second, with revisions 1..n and a final revision above them.
  - A partial that is in flight at key-up does not override the final.
  - Two devices on one engine both get partials, and a final is served before the other device's pending partial.
  - Failure keeps the text recognised so far.
  - Cancel.
  - An event listener that throws makes `finish` reject instead of causing an unhandled rejection.

## Deviations and interpretations

- **Which pause counts as "the longest pause found".** Candidates are pauses >= 200 ms whose midpoint lies at least 10 s (`minSegmentMs`) into the segment. A commit is triggered once the tail is >= 15 s and either a pause just ended or the silence has lasted 500 ms. At 25 s the longest candidate is still used if one exists; only without any candidate is it a blind hard cut. Setting `minSegmentMs = targetMs` gives the spike's "longest pause since the target was reached".
- **Hard limit.** It is measured on the job audio including its lead-in, so no call is longer than 25 s. The spike counted 25 s + 1 s.
- **"Partials dropped when busy".** On one device this means dropped whenever the engine is busy with that device. With several devices a partial may wait in that device's single slot, because pure dropping let devices phase-lock and starve each other in the spike.
- **Active devices** are the attached sessions that have partials enabled.
- **Optional spike idea, adopted.** A partial tick is skipped when no voiced audio arrived since the last request.
- **Silence handling.**
  - Segments without voiced audio are not sent to the engine. Their final is emitted with empty text.
  - The end segment is skipped after a cut if nothing was voiced since that cut.
  - A dictation with no cut is always sent, so quiet speech is never lost to the VAD.
- **Small changes against the plan:**
  - `Segment` has a `voiced` flag.
  - `Segmenter` exposes `openLeadInSamples`.
  - `acceptPartial` takes the lead-in.
  - `skipFinal` emits an empty final, so every segment gets exactly one final.
  - The options type lives in `rolling-session-options.ts`.
  - Partial revisions may have gaps, because a revision is allocated even when the job is dropped.
- **Protocol alignment.** I told the phase 2 agent that the events match its `final { segmentId, text }` and `partial { segmentId, revision, text }` shapes, that the final's revision can be left out, and that empty final texts can happen.

## CodeRabbit

`coderabbit review --agent --base main`, first run: 7 findings, all fixed in `baa217e`, with tests.

1. Rejections from event listeners leaked out of `RollingSession` and `finish` could hang. They are now recorded and reject `finish`.
2. Segment config accepted NaN and negative values. Added finite and non-negative checks.
3. Completing a job of a removed and then re-added device corrupted the new lane. The running lane is now tracked per entry.
4. Fuzzy single-word overlap could delete a real word (`right`/`night`). Partly accepted: exact-only would bring back the spike's `zahodíme.`/`zahodím.` miss. One-word overlaps now match only when the words differ in the ending.
5. VAD config accepted NaN and Infinity. Added finite checks.
6. The timeline fake engine silently picked the first of several identical audio keys. It now rejects ambiguous offsets.
7. `PcmBuffer` accepted fractional sample positions. These now throw `RangeError`.

Second run: 0 findings.

## How to wire this into LocalEngine and the gateway

**LocalEngine (desktop main):**

- Create one `TranscriptionDispatcher` per engine instance:
  - `transcriber`: a `SegmentTranscriber` that calls `runTranscribeCli({ binary, model, backend, threads, language, pcm, signal })`.
  - `clock: systemClock`.
- Per dictation, create a `RollingSession`:
  - `deviceId: 'local'`
  - `partials` = overlay mode is Živý text
  - `submitter`, `registry`: the dispatcher
  - `interval: dispatcher.partialIntervalSource()`
  - `onEvent` forwards to the overlay
- Map the engine calls:
  - `pushAudio(frame)` becomes `session.push(frame)`.
  - `finish()` becomes `await session.finish()`. The result is the text to insert.
  - `cancel()` becomes `session.cancel()`.
  - On `SegmentFailedError`, keep `textSoFar` as the last transcript (spec 5.4).
- This replaces `chunkPcm` plus sequential calls. Each job is at most 25 s, and committed segments are transcribed while the user is still talking.
- With a resident transcribe.cpp model, service times drop and the EWMA keeps the interval at 1 s. A slow CPU stretches the interval automatically.
- `TranscriptionEngine` needs to grow from `transcribe(pcm)` to `start / pushAudio / finish / cancel` plus `partial`/`final` events (spec 5.4). `RollingSession` already has that shape.

**Gateway (apps/server):**

- One `TranscriptionDispatcher` per STT sidecar, shared by all device sessions. Its `SegmentTranscriber` posts the PCM to the sidecar with the session language and passes the `AbortSignal` to `fetch`.
- One `RollingSession` per client dictation:
  - `deviceId` = paired device id
  - `partials` from the client's overlay mode
  - `onEvent` maps to protocol `partial { segmentId, revision, text }` and `final { segmentId, text }`
- Map the client messages:
  - Client audio frames become `push`.
  - End of speech becomes `finish`.
  - Disconnect, cancel or revocation becomes `cancel` (aborts in-flight sidecar calls, spec 9 revocation test).
- The dispatcher's single-flight queue is what keeps a 503 from ever reaching a client. Do not add sidecar-level retries that bypass it.
- For the 2-minute retry buffer (spec 5.4), stable segment ids from 0 let the client drop finals it already has.
