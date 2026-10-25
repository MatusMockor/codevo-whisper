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
| Transcript | `transcript/*` | `TranscriptAssembler` handles segment ids (from 0), revisions per segment and finals released in order. Each final is deduped against the last non-empty final using `ceil(leadInMs / 150)` words (was 250 before the review fixes). Late partials are dropped. `TranscriptEvent = { type: 'partial' \| 'final', segmentId, revision, text }`. |
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
  - `transcriber`: a `SegmentTranscriber` whose `transcribe(job, signal)` calls `runTranscribeCli({ binary, model, backend, threads, language: job.context.language, pcm: job.pcm, signal })`.
  - `clock: systemClock`.
- Per dictation, create a `RollingSession`:
  - `deviceId: 'local'`. Overlapping dictations are fine: each session gets its own session id from `attach`.
  - `context: { language, model }` from the settings at recording start
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

- One `TranscriptionDispatcher` per STT sidecar, shared by all device sessions. Its `SegmentTranscriber` posts `job.pcm` to the sidecar with `job.context.language` (Canary needs an explicit language) and passes the `AbortSignal` to `fetch`.
- One `RollingSession` per client dictation:
  - `deviceId` = paired device id (fairness lane). A reconnect retry of the same device can overlap the old session safely.
  - `context` from the client's session settings
  - `partials` from the client's overlay mode
  - `onEvent` maps to protocol `partial { segmentId, revision, text }` and `final { segmentId, text }`
- Map the client messages:
  - Client audio frames become `push`.
  - End of speech becomes `finish`.
  - Disconnect, cancel or revocation becomes `cancel`. It only aborts that session's in-flight sidecar call (spec 9 revocation test).
- The dispatcher's single-flight queue is what keeps a 503 from ever reaching a client. Do not add sidecar-level retries that bypass it.
- For the 2-minute retry buffer (spec 5.4), stable segment ids from 0 let the client drop finals it already has.

## Review fixes

Phase-level review, 2026-10-25. Each fix was written test-first. Commits: `b480427`, `5a4d4a2`, `b2a7431`.

1. **Session identity** (`b480427`):
   - Before, overlapping sessions with the same device id (LocalEngine `'local'`, gateway reconnect retries) could abort each other's finals and remove each other's registration.
   - `DeviceRegistry.attach(deviceId, partials)` now returns a unique session id. `detach(sessionId)` and `JobSubmitter.cancelSession(sessionId)` act on one session only.
   - The device id is used only for fairness lanes and for the active-device count (distinct device ids). `FairJobQueue` admission (`partial-in-flight`, `finalizing`, replace, supersede) is per session.
   - A final dropped without the session's own cancel becomes `SegmentFailedError`.
   - Tests: two overlapping `'local'` sessions stay independent, a dropped final rejects `finish`, `cancelSession` on a shared device, distinct session ids.
2. **Per-session engine context** (`b480427`):
   - `TranscriptionJob<TContext>` carries `context` (default `TranscriptionContext = { language: string; model?: string }`). `RollingSessionOptions.context` sets it.
   - `SegmentTranscriber.transcribe(job, signal)` receives the whole job, so one dispatcher can serve sessions with different languages and models. The dispatcher, session and submitter types are generic over `TContext`.
3. **Boundary dedup** (`5a4d4a2`):
   - The word cap is now `ceil(leadInMs / 150)`: 7 words for a 1 s overlap, 4 for the 0.5 s pre-roll. The old cap of 4 missed 5-word overlaps.
   - Pre-roll fragments: the first word of the next segment matches when it is a suffix (3 or more letters) of the aligned previous word (`díme.` against `zahodíme.`). It is dropped with the overlap.
   - Truncated word at a hard cut: finals are never revised, so a cut-off last word (`pokrač`) cannot be fixed after it was emitted. Instead, a final of a hard-cut segment holds back its last word, and the next final resolves it (`resolveBoundary(previous, carried, next, maxWords)`):
     - when the carried word is a prefix of next's word (stem of 4 or more letters), the full word from next wins;
     - when next starts with a fragment of the carried word, the carried word wins;
     - when they match exactly or fuzzily, next's version wins;
     - when nothing overlaps, the carried word is prepended.
   - The truncation rule only applies to the carried word, so `pred` / `predtým` after a pause cut is not merged.
   - The `Segmenter` always emits the end segment after a hard cut (it re-reads the overlap) so the held-back word is always resolved. A failed or skipped follow-up segment emits the held-back word as its text.
   - The partial after a hard cut is resolved against the held-back word the same way.
   - Test fake: `TimelineTranscriber` modes `wordMs` (300 or 200 ms = 5 words/s), `truncateAtCut`, `fragmentAtStart`.
   - New end-to-end tests: truncation, fragments, 5 words/s with truncation and fragments, and the pause fixture with fragments at normal and fast speech. Unit tests cover `resolveBoundary`, the fragment and truncation rules, 5-word overlaps and `splitLastWord`.
4. **Retry after a drop:** a dropped partial outcome sets `voicedSinceRequest` back to true, so the next tick retries even if the user went silent. Test: `a partial dropped while the previous one is in flight is retried on the next tick` (fails without the fix).
5. **Listener errors:** events are delivered one by one inside `try`/`catch`. A listener error becomes `SegmentFailedError` for that segment, also on the synchronous skip path inside `push`. Test: a throwing listener during a 22 s silent dictation does not escape `push`.
6. **`SegmentTranscriber` contract** (documented here, not as a code comment, because the owner's rule is no code comments):
   - Implementations must stop work and reject promptly when `signal` aborts (`cancelSession`, revocation).
   - They must enforce their own per-call timeout and reject on expiry.
   - A call that never settles blocks the dispatcher's single queue for every device.
   - The dispatcher does not race calls against a timer, because that would break single-flight (the engine would still be busy).
7. **VAD floor:**
   - Frames at `silenceDb` (digital zero) no longer feed the floor and peak trackers, so a zeroed mic warm-up does not drag the floor to -100 dBFS. Test: a 2 s digital-zero prefix leaves every decision on the following speech unchanged (fails without the fix).
   - Noise-step test: clean speech, then -30 dBFS noise from 3 s; both later sentence pauses are still found.
8. **Service time:** samples are clamped to 0-10000 ms (non-finite counts as the maximum) before the EWMA, so a clock jump cannot blow up or zero the partial interval.
9. **Test hygiene:**
   - `ControllableTranscriber.call()` asserts the call exists (`assert.isDefined`).
   - No `if` branching left in test bodies; `takeDefined` is used in the queue tests.
   - New session tests: a silence-only dictation over 20 s makes no engine call, resolves `''` and emits only empty finals. An exactly 25 s dictation gives a hard segment plus an end segment that re-reads the overlap, with the exact word sequence (truncation and fragments on).

Tests after the fixes: `packages/audio` has 20 files and 164 tests; the whole repo has 479 passing (1 skipped, which already existed). Lint and typecheck are green.

Notes for the integration task (no code now):

- The gateway needs an ingestion rate limit per session and device. A client pushing audio faster than real time would create commits and partial jobs faster than real time.
- `nextInRotation` restarts from the first lane when the last-served device was removed. That gives a small bias to the first device after a removal; worth revisiting if fairness measurements show it.

Second reviewer (gpt-6.1-sol, `codex exec -s read-only`, on `baa217e..b2a7431`): 2 P2 findings, both reproduced and fixed in `55e6ac8`:

- **Carried word lost from final events.** With `overlapMs: 0, preRollMs: 0`, a dictation ending exactly at a hard cut produced no end segment, so the held-back word only appeared in `finish()`'s text. `validateSegmentConfig` now requires `max(overlapMs, preRollMs) >= 20 ms` (`MIN_HARD_CUT_LEAD_IN_MS`), so the end segment after a hard cut always exists. The exactly-25 s test also checks that the final event texts join to the `finish()` text.
- **Finished sessions retained.** Finished sessions stayed in the queue, and lanes of cancelled devices were never removed. `detach` now calls `FairJobQueue.releaseSession`, which forgets the session once it has no queued or running jobs; empty lanes are pruned. Tests: queue `stats()` after complete/release/remove, and 50 finished plus 1 cancelled session through the dispatcher leave `{ sessions: 0, lanes: 0 }`.

Tests after these fixes: `packages/audio` has 20 files and 168 tests; the repo has 483 passing (1 skipped, which already existed).

CodeRabbit after the fixes: blocked by the free CLI allowance (`rate_limit`: "You've used all 3 included reviews"); retries at the advertised reset kept hitting the limit. The repository has no Git remote, so an organization plan cannot apply. The gpt-6.1-sol review above stands in until CodeRabbit can run again.
