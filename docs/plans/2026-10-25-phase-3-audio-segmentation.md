# Phase 3 - Audio Segmentation Core (`packages/audio`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure TypeScript package `@codevo-whisper/audio` that turns a live PCM16 stream into engine jobs (rolling partials and committed finals) and engine results into `partial` / `final` transcript events with segment ids and revisions, shared later by `LocalEngine` and the gateway.

**Architecture:** Small units composed by one per-dictation `RollingSession`: an adaptive-noise-floor VAD produces 20 ms frames, a `Segmenter` applies the commit policy (target / hard cut / overlap / pre-roll), a `PartialGate` decides when to re-transcribe the tail, a `TranscriptAssembler` assigns revisions, orders finals and removes boundary duplicates with fuzzy matching. Engine calls go through a `TranscriptionDispatcher` built on a pure `FairJobQueue` (finals before partials, round-robin per device, partials dropped when busy) and an injected `SegmentTranscriber`. Time comes from an injected `Clock`; no I/O in `src/`.

**Tech Stack:** Node 24, pnpm 10.34.5 workspace, TypeScript 6 strict ESM (`tsconfig.base.json`), Vitest 5, ESLint 10 with typescript-eslint.

**Spec:** `docs/specs/2026-10-25-codevo-whisper-design.md` sections 5.3 (partials only in Živý text), 5.4 (`partial` / `final` events with segment ids and revisions), 6 (live transcript and long dictation), 9 (`packages/audio` tests with recorded PCM fixtures including continuous speech). Evidence: `docs/spikes/rolling-latency.md`, prototype `spikes/rolling-latency/measure.ts`.

## Global Constraints

- Audio format everywhere: PCM16 little-endian, mono, 16 kHz (`apps/desktop/src/shared/pcm.ts`). Input chunks are `Uint8Array` (as `pushAudio` delivers them, normally 100 ms frames); job PCM is a copied `Uint8Array`.
- Defaults from spec 6 and the spike: target 15 s, hard cut 25 s, overlap 1 s on hard cuts, 0.5 s pre-roll before a cut, min pause 200 ms, partial interval `clamp(activeDevices x 1 s, 1 s, 3 s)`, partials need >= 0.5 s of tail.
- No engine call longer than 25 s of audio (hard limit is measured on the job audio including its lead-in; spike limit is 30 s / 960000 bytes).
- Finals have priority over partials; a device never has more than one partial pending or in flight; partials are dropped (never queued behind the device's own work) when that device's partial is in flight or its final is pending.
- Package is pure: no `node:` imports in `src/`, no timers, no filesystem, no network. Tests may read fixtures with `node:fs`.
- Only true external boundary faked in tests: the speech engine (`SegmentTranscriber`). Everything else runs for real.
- No code comments. Guard clauses, never `else` (ESLint `IfStatement[alternate]`). Small focused files, one responsibility each. Interfaces for swappable parts (`Clock`, `VoiceActivityDetector`, `SegmentTranscriber`, `JobSubmitter`, `PartialIntervalSource`).
- Do not modify `apps/desktop`, `native/`, `apps/server`. Root config changes only if additive and needed (the `packages/*` workspace glob and the vitest `projects` glob already cover a new package).
- Verification after every task: `pnpm lint`, `pnpm typecheck`, `pnpm test`. One commit per task on branch `phase-3-audio`, never on `main`, no push.

## Decisions This Plan Makes (spec interpretation)

- **Adaptive noise floor (measured on the spike audio before writing this plan):** frame energy `10*log10(meanSquare / 32768^2)` dBFS on 20 ms frames; floor = minimum frame energy over the last 3 s, peak = maximum over the last 3 s, both seeded with a prior floor of -60 dBFS that expires after one window (avoids false pauses when recording starts mid-speech). Onset threshold `floor + max(6 dB, 0.5 x (peak - floor))`, release threshold `floor + max(3 dB, 0.4 x (peak - floor))` (hysteresis). On the clean TTS sample this finds exactly the sentence pauses found by the fixed RMS-500 threshold of the spike; with added white noise at -30 dBFS (where the fixed threshold finds none) it still finds them.
- **Which pause is "the longest pause found":** candidates are pauses >= 200 ms whose midpoint lies at least `minSegmentMs` (10 s) after the segment start. A pause commit is triggered when the tail is >= 15 s and either a pause >= 200 ms has just ended (speech resumed, so its full length is known) or the ongoing silence reached 500 ms (`settledPauseMs`). The cut goes to the midpoint of the longest candidate (ties: the later one). At 25 s the same choice is made if any candidate exists; only with no candidate is it a hard cut with 1 s overlap. Setting `minSegmentMs = targetMs` gives the spike's "longest pause since the target was reached".
- **Lead-in:** after a pause cut the next segment starts 0.5 s before the cut (pre-roll); after a hard cut it starts `max(overlap, preRoll)` = 1 s before. Dedup uses at most `ceil(leadInMs / 250)` words.
- **"Partials dropped when the engine is busy":** a partial tick is dropped when the device already has a partial in flight or a final pending / in flight (that is: one device on one engine = dropped whenever the engine is busy). With several devices a partial may wait in the device's single pending slot (replaced by a newer tick) so devices cannot phase-lock and starve each other, which the spike showed for drop-on-503.
- **Active devices** for the partial interval = sessions attached to the dispatcher with partials enabled (Indikátor sessions request no partials, so they do not use the partial budget).
- **Optional spike idea adopted:** a partial tick is skipped when no voiced frame arrived since the previous partial request (the text cannot have changed).
- **Revisions:** per segment, strictly increasing, allocated when a job is created (gaps allowed when a job is dropped). The final's revision is greater than every partial revision of that segment. Late partials for a committed segment are discarded. Finals are released in segment order.
- **End of dictation:** the remaining tail becomes an `end` segment, except after a previous cut when no voiced frame arrived after that cut (avoids one extra engine call that only re-reads the pre-roll). A dictation with no cut is always sent (quiet speech must never be dropped by the VAD).

## Review Focus

- Recording starts mid-speech (hotkey pressed while already talking, fixture starts in a word): no false pauses in the first window. Pinned in Task 2 (`does not report pauses while the prior floor is in effect on speech that starts mid-word`).
- Background noise level jumps (fan, street) while dictating: pauses are still found after one floor window. Pinned in Task 2 (`finds the sentence pauses with white noise at -30 dBFS`).
- Long continuous speech with no pause at all (fluent speaker, 35 s): only hard cuts, every job <= 25 s, words in the overlap appear once in the final text. Pinned in Task 3 (`continuous speech only hard cuts and no job exceeds 25 s`) and Task 9 (`continuous speech end to end has no duplicated or missing words`).
- Key released while a partial of the same device is in flight: the final is still produced, the late partial is not shown after the final. Pinned in Task 5 (`ignores a partial that arrives after its segment was committed`) and Task 9 (`a partial in flight at finish does not overwrite the final`).
- Two devices dictating at once on one engine: neither starves; finals of one device are not delayed by queued partials of the other. Pinned in Task 7 (`serves partials round-robin across devices`) and Task 9 (`two devices both receive partials and their finals come before pending partials`).

---

### Task 1: Package scaffold and PCM primitives

**Files:**
- Create: `packages/audio/package.json`, `packages/audio/tsconfig.json`, `packages/audio/vitest.config.ts`, `packages/audio/src/index.ts`
- Create: `packages/audio/src/pcm/pcm-format.ts`, `packages/audio/src/pcm/pcm-buffer.ts`, `packages/audio/src/clock.ts`
- Test: `packages/audio/test/pcm/pcm-format.test.ts`, `packages/audio/test/pcm/pcm-buffer.test.ts`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Produces:
  - `PCM_SAMPLE_RATE = 16_000`, `PCM_BYTES_PER_SAMPLE = 2`, `msToSamples(ms: number): number` (rounded), `samplesToMs(samples: number): number`, `decodePcm16le(bytes: Uint8Array): Int16Array` (whole samples only, any byte offset).
  - `class PcmBuffer { append(bytes: Uint8Array): Int16Array; get endSample(): number; get startSample(): number; slice(fromSample: number, toSample: number): Uint8Array; discardBefore(sample: number): void }` - absolute sample indices since the session start; `append` carries an odd trailing byte to the next call and returns the newly completed samples; `slice` returns a copy; `slice` outside `[startSample, endSample]` throws `RangeError`.
  - `interface Clock { now(): number }` (milliseconds, monotonic), `systemClock: Clock` (uses `performance.now()`).

- [ ] **Step 1: Scaffold** `package.json` like `packages/stt-runner` (name `@codevo-whisper/audio`, `exports: { ".": "./src/index.ts" }`, scripts `typecheck`/`test`, devDependencies `@types/node 24.19.2`, `typescript 6.0.3`, `vitest 5.0.5`), `tsconfig.json` extending the base with `types: ["node"]`, `vitest.config.ts` with `name: 'audio'`. Run `pnpm install` (offline if possible).
- [ ] **Step 2: Write failing tests**: `decodePcm16le decodes little-endian samples` (`[0x01,0x00,0xff,0xff,0x00,0x80]` -> `[1,-1,-32768]`), `decodePcm16le ignores a trailing odd byte`, `msToSamples(20) === 320`, `samplesToMs(16000) === 1000`; `PcmBuffer keeps absolute positions after discardBefore` (append 3 x 1600 samples, `discardBefore(2000)`, `startSample === 2000`, `slice(2000, 2002)` equals the original bytes at those samples), `PcmBuffer carries an odd byte across appends` (append 3 bytes then 1 byte -> `endSample === 2`, second append returns 1 sample), `slice returns a copy`, `slice before startSample throws RangeError`.
- [ ] **Step 3: Run** `pnpm vitest run --project audio` - FAIL (modules missing).
- [ ] **Step 4: Implement** the functions and `PcmBuffer` (growable `Uint8Array` with doubling, `copyWithin` on discard). Export everything from `src/index.ts`.
- [ ] **Step 5: Run** `pnpm vitest run --project audio` - PASS; then `pnpm lint && pnpm typecheck && pnpm test` - all green.
- [ ] **Step 6: Commit** `feat(audio): package scaffold and PCM buffer`.

### Task 2: Adaptive noise-floor VAD

**Files:**
- Create: `packages/audio/src/vad/vad-config.ts`, `packages/audio/src/vad/frame-energy.ts`, `packages/audio/src/vad/sliding-extremum.ts`, `packages/audio/src/vad/adaptive-vad.ts`, `packages/audio/src/vad/voice-activity-detector.ts`
- Create fixtures: `packages/audio/test/fixtures/speech-pauses.pcm` (0.0-12.0 s of the spike's `speech16k.pcm`, 384000 bytes, sentence pauses near 6.9 s and 10.2 s), `packages/audio/test/fixtures/speech-continuous.pcm` (32.6-44.3 s, 374400 bytes, no pause >= 200 ms); provenance goes in the report.
- Create: `packages/audio/test/support/fixtures.ts` (`loadFixture(name): Int16Array`, `toBytes(samples: Int16Array): Uint8Array`, `concatSamples(...parts: Int16Array[]): Int16Array`), `packages/audio/test/support/signals.ts` (`silence(ms)`, `tone(ms, amplitude, hz = 220)`, `addWhiteNoise(samples, rmsAmplitude, seed)` with a seeded LCG)
- Test: `packages/audio/test/vad/frame-energy.test.ts`, `packages/audio/test/vad/sliding-extremum.test.ts`, `packages/audio/test/vad/adaptive-vad.test.ts`

**Interfaces:**
- Consumes: `msToSamples`, `PCM_SAMPLE_RATE` (Task 1).
- Produces:
  - `type VadFrame = { startSample: number; endSample: number; energyDb: number; voiced: boolean }`
  - `interface VoiceActivityDetector { process(samples: Int16Array): VadFrame[] }` - keeps a remainder shorter than one frame between calls; positions continue across calls.
  - `type VadConfig = { frameMs: number; floorWindowMs: number; priorFloorDb: number; onsetRatio: number; releaseRatio: number; minOnsetMarginDb: number; minReleaseMarginDb: number; silenceDb: number }`, `DEFAULT_VAD_CONFIG = { frameMs: 20, floorWindowMs: 3000, priorFloorDb: -60, onsetRatio: 0.5, releaseRatio: 0.4, minOnsetMarginDb: 6, minReleaseMarginDb: 3, silenceDb: -100 }`, `validateVadConfig(config): VadConfig` (throws `RangeError` when `frameMs` is outside 20-30 or ratios are outside (0, 1] or `releaseRatio > onsetRatio`).
  - `frameEnergyDb(samples: Int16Array, from: number, to: number, silenceDb: number): number`.
  - `class SlidingExtremum { constructor(windowSize: number, compare: (a: number, b: number) => boolean); push(value: number): void; get value(): number }` (monotonic deque).
  - `class AdaptiveVad implements VoiceActivityDetector { constructor(config?: Partial<VadConfig>) }`.

- [ ] **Step 1: Extract fixtures** from `/Users/matusmockor/Developer/codevo-whisper/spikes/rolling-latency/.data/speech16k.pcm` with a throwaway script outside the repo (byte ranges `[0, 384000)` and `[1043200, 1417600)`); check total < 1 MB.
- [ ] **Step 2: Write failing tests**:
  - `frameEnergyDb of full-scale square is ~0 dB`, `of zeros is silenceDb`.
  - `SlidingExtremum tracks the minimum over the last N values` (push 5,3,4,6,7 with window 3 -> 3,3,3,3,4 after each push from the 3rd).
  - `labels silence and a tone after silence` (1 s silence + 1 s tone at amplitude 8000: frames < 1 s unvoiced, frames > 1.04 s voiced).
  - `keeps positions across uneven chunks` (feed 1600 samples as 7 + 1593 + 1600: frames are contiguous 320-sample frames starting at 0).
  - `finds the sentence pauses of the recorded fixture` (`speech-pauses.pcm`: unvoiced runs >= 200 ms start within 6.80-6.95 s and 10.10-10.25 s, and no other run >= 200 ms after 3 s).
  - `finds the sentence pauses with white noise at -30 dBFS` (noise RMS 1000, seed 7: runs >= 200 ms covering 6.9 s and 10.2 s exist; a fixed threshold of energy < -36 dBFS finds no run >= 200 ms, asserted to show the fixture is meaningful).
  - `does not report pauses while the prior floor is in effect on speech that starts mid-word` (`speech-continuous.pcm`: no unvoiced run >= 200 ms at all).
  - `validateVadConfig rejects 10 ms frames`.
- [ ] **Step 3: Run** `pnpm vitest run --project audio test/vad` - FAIL.
- [ ] **Step 4: Implement.** Per frame: energy; push into the min and max `SlidingExtremum` (window `floorWindowMs / frameMs` frames, both seeded with `priorFloorDb` for the first window); `range = max(0, peak - floor)`; voiced state with hysteresis: `voiced ? energy >= floor + max(minReleaseMarginDb, releaseRatio*range) : energy >= floor + max(minOnsetMarginDb, onsetRatio*range)`.
- [ ] **Step 5: Run** tests - PASS; `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] **Step 6: Commit** `feat(audio): adaptive noise floor VAD with recorded fixtures`.

### Task 3: Segment policy

**Files:**
- Create: `packages/audio/src/segmentation/segment-config.ts`, `packages/audio/src/segmentation/pause-tracker.ts`, `packages/audio/src/segmentation/select-cut.ts`, `packages/audio/src/segmentation/segmenter.ts`, `packages/audio/src/segmentation/segment.ts`
- Test: `packages/audio/test/segmentation/pause-tracker.test.ts`, `packages/audio/test/segmentation/select-cut.test.ts`, `packages/audio/test/segmentation/segmenter.test.ts`, `packages/audio/test/support/frames.ts` (`framesFromPattern(pattern: string, frameMs = 20)` where each char is one frame, `#` voiced, `.` unvoiced, plus `voicedMs(ms)` / `silentMs(ms)` builders)

**Interfaces:**
- Consumes: `VadFrame` (Task 2), `msToSamples` (Task 1).
- Produces:
  - `type SegmentConfig = { targetMs: number; hardMs: number; minSegmentMs: number; overlapMs: number; preRollMs: number; minPauseMs: number; settledPauseMs: number }`, `DEFAULT_SEGMENT_CONFIG = { targetMs: 15000, hardMs: 25000, minSegmentMs: 10000, overlapMs: 1000, preRollMs: 500, minPauseMs: 200, settledPauseMs: 500 }`, `validateSegmentConfig(config): SegmentConfig` (`RangeError` unless `minPauseMs <= settledPauseMs`, `max(overlapMs, preRollMs) < minSegmentMs <= targetMs < hardMs`).
  - `type Pause = { startSample: number; endSample: number }`
  - `class PauseTracker { constructor(minPauseSamples: number); observe(frame: VadFrame): Pause | undefined /* returns the pause that just ended */; ongoing(): Pause | undefined /* current run if >= min */; candidates(fromSample: number): Pause[] /* ended + ongoing, midpoint >= fromSample */; prune(beforeSample: number): void; get silentSamples(): number }`
  - `selectCut(candidates: Pause[]): number | undefined` - midpoint of the longest, ties to the later.
  - `type CutReason = 'pause' | 'hard' | 'end'`
  - `type Segment = { id: number; startSample: number; endSample: number; leadInSamples: number; reason: CutReason }` (`leadInSamples` = samples before the previous cut repeated at the start).
  - `class Segmenter { constructor(config?: Partial<SegmentConfig>); onFrame(frame: VadFrame): Segment | undefined; finish(endSample: number): Segment | undefined; get openSegmentId(): number; get openStartSample(): number; get voicedSinceCut(): boolean }`

- [ ] **Step 1: Write failing tests**:
  - PauseTracker: `reports a pause when speech resumes after >= 200 ms` / `ignores a 180 ms dip` / `ongoing returns the current run once it reaches the minimum` / `candidates filters by midpoint`.
  - selectCut: `picks the longest pause midpoint`, `prefers the later pause on a tie`, `returns undefined without candidates`.
  - Segmenter (synthetic frames): `does not cut before the target even after a long pause` (12 s voiced + 1 s silence + voiced -> no segment), `cuts at the longest pause once a pause ends after the target` (voiced to 11 s, 300 ms pause, voiced to 16 s, 220 ms pause, voiced: segment 0 ends at the midpoint of the 300 ms pause (11.15 s), reason `pause`, next `openStartSample` = 10.65 s), `cuts on a settled 500 ms silence without waiting for speech`, `hard cut at 25 s with 1 s overlap when no pause qualifies` (segment `endSample` = 25 s, next start 24 s, next segment `leadInSamples` = 16000), `at the hard limit cuts at an earlier candidate pause instead of mid-word` (pause at 12 s, continuous after: cut at 12 s midpoint, reason `pause`), `finish emits the remaining tail as an end segment`, `finish skips the end segment when nothing was voiced after a cut`, `finish always emits the only segment even if unvoiced`, `segment ids increase from 0`.
  - Segmenter on fixtures (frames from `AdaptiveVad`): `three pause fixtures in a row commit at a pause between 10 and 25 s` (`speech-pauses` x 3: first segment reason `pause`, endSample within a pause found by the VAD, length >= 10 s), `continuous speech only hard cuts and no job exceeds 25 s` (`speech-continuous` x 3, about 35 s: segments `hard` then `end`, every `endSample - startSample <= 25 s`).
- [ ] **Step 2: Run** - FAIL.
- [ ] **Step 3: Implement.** `onFrame`: track voiced-since-cut, feed `PauseTracker`; `tail = frame.endSample - start`; if `tail >= hard`: `selectCut(candidates(start + minSegment))` else hard cut at `frame.endSample`; if `tail >= target` and (`observe` returned a pause or the ongoing silence just reached `settledPauseMs`): cut at `selectCut(...)` when defined. A cut sets `start = cut - leadIn` (`preRoll` for pause, `max(overlap, preRoll)` for hard), increments the id, prunes the tracker.
- [ ] **Step 4: Run** - PASS; lint/typecheck/test green.
- [ ] **Step 5: Commit** `feat(audio): segment policy with longest-pause commit and hard cut overlap`.

### Task 4: Fuzzy boundary dedup

**Files:**
- Create: `packages/audio/src/dedup/normalize-word.ts`, `packages/audio/src/dedup/edit-distance.ts`, `packages/audio/src/dedup/words-match.ts`, `packages/audio/src/dedup/remove-boundary-duplicates.ts`
- Test: `packages/audio/test/dedup/edit-distance.test.ts`, `packages/audio/test/dedup/words-match.test.ts`, `packages/audio/test/dedup/remove-boundary-duplicates.test.ts`

**Interfaces:**
- Produces:
  - `normalizeWord(word: string): string` - NFD, strip `\p{M}`, lowercase, keep `\p{L}\p{N}` only.
  - `editDistance(a: string, b: string): number` (Levenshtein, two rows).
  - `wordsMatch(a: string, b: string): boolean` - on normalized words: equal, or shorter length >= 4 and distance <= 1, or shorter length >= 7 and distance <= 2; empty never matches.
  - `removeBoundaryDuplicates(previous: string, next: string, maxOverlapWords: number): string` - finds the largest `k <= maxOverlapWords` where the last `k` comparable words of `previous` match the first `k` of `next` pairwise; returns `next` without those leading tokens (original spelling of the rest, single spaces, trimmed). Tokens that normalize to empty are skipped in comparison and removed if they sit inside the duplicate prefix. `maxOverlapWords <= 0` returns `next` trimmed.

- [ ] **Step 1: Write failing tests**: `editDistance('zahodíme', 'zahodím') === 1`; `wordsMatch('zahodíme.', 'Zahodím') === true`, `wordsMatch('a', 'v') === false`, `wordsMatch('je', 'je') === true`, `wordsMatch('segment', 'fragment') === false`; `removes an exact overlap ignoring case and punctuation` (`'Potom ho zahodíme.'`, `'ho zahodíme, a pokračujeme'`, 4 -> `'a pokračujeme'`), `removes an inflected overlap` (`'... a potom to zahodíme.'`, `'zahodím. Potom ...'`, 4 -> `'Potom ...'`), `keeps text when nothing overlaps`, `respects maxOverlapWords` (overlap of 3 with max 2 -> nothing removed unless a 1-2 word overlap exists), `does not remove when maxOverlapWords is 0`, `prefers the longest overlap`.
- [ ] **Step 2: Run** - FAIL. **Step 3: Implement.** **Step 4: Run** - PASS; lint/typecheck/test green.
- [ ] **Step 5: Commit** `feat(audio): fuzzy word dedup across segment boundaries`.

### Task 5: Transcript assembler (segment ids, revisions, ordering)

**Files:**
- Create: `packages/audio/src/transcript/transcript-event.ts`, `packages/audio/src/transcript/transcript-assembler.ts`
- Test: `packages/audio/test/transcript/transcript-assembler.test.ts`

**Interfaces:**
- Consumes: `removeBoundaryDuplicates` (Task 4), `Segment` (Task 3).
- Produces:
  - `type TranscriptEvent = { type: 'partial' | 'final'; segmentId: number; revision: number; text: string }`
  - `class TranscriptAssembler { constructor(msPerOverlapWord = 250); nextPartialRevision(segmentId: number): number; commit(segment: Segment): number /* final revision */; acceptPartial(segmentId: number, revision: number, text: string): TranscriptEvent | undefined; acceptFinal(segmentId: number, text: string): TranscriptEvent[]; skipFinal(segmentId: number): TranscriptEvent[]; text(): string; get pendingFinals(): number }`
  - Rules: revisions per segment start at 1 and only increase; a partial is emitted only if its segment is not committed and its revision is higher than the last emitted one; finals are released in id order, deduped against the last non-empty released final with `ceil(leadInMs / msPerOverlapWord)` words; a released partial is deduped the same way against the previous segment's final when that is released; `skipFinal` releases a failed segment as empty without an event; `text()` joins non-empty finals with one space.

- [ ] **Step 1: Write failing tests**: `revisions increase per segment and restart for the next segment`, `the final revision is above every partial revision`, `drops a partial older than the last emitted one`, `ignores a partial that arrives after its segment was committed`, `releases finals in segment order` (accept final 1 before 0 -> no event, then 0 -> two events in order), `dedups a final against the previous final using the lead-in` (segment 1 with 1 s lead-in: `'… potom to zahodíme.'` then `'zahodím. Potom …'` -> final 1 text `'Potom …'`), `does not dedup a segment without lead-in`, `dedups a partial against the released previous final`, `skipFinal unblocks later finals`, `text joins finals`.
- [ ] **Step 2: Run** - FAIL. **Step 3: Implement.** **Step 4: Run** - PASS; lint/typecheck/test green.
- [ ] **Step 5: Commit** `feat(audio): transcript assembler with segment ids and revisions`.

### Task 6: Partial cadence

**Files:**
- Create: `packages/audio/src/partials/partial-config.ts`, `packages/audio/src/partials/partial-interval.ts`, `packages/audio/src/partials/service-time-estimator.ts`, `packages/audio/src/partials/partial-gate.ts`
- Test: `packages/audio/test/partials/partial-interval.test.ts`, `packages/audio/test/partials/service-time-estimator.test.ts`, `packages/audio/test/partials/partial-gate.test.ts`

**Interfaces:**
- Produces:
  - `type PartialConfig = { baseIntervalMs: number; minIntervalMs: number; maxIntervalMs: number; targetLoad: number; minTailMs: number }`, `DEFAULT_PARTIAL_CONFIG = { baseIntervalMs: 1000, minIntervalMs: 1000, maxIntervalMs: 3000, targetLoad: 0.55, minTailMs: 500 }`.
  - `partialIntervalMs(activeDevices: number, serviceMs: number | undefined, config: PartialConfig): number` = `clamp(max(1, activeDevices) x max(baseIntervalMs, (serviceMs ?? 0) / targetLoad), minIntervalMs, maxIntervalMs)`.
  - `class ServiceTimeEstimator { constructor(alpha = 0.3); record(ms: number): void; get valueMs(): number | undefined }` (EWMA, first sample initialises).
  - `interface PartialIntervalSource { partialIntervalMs(): number }`
  - `class PartialGate { constructor(startedAt: number, minTailMs: number); isDue(now: number, intervalMs: number, tailMs: number, voicedSinceRequest: boolean): boolean; markRequested(now: number): void }` - due when `now - lastRequest >= intervalMs` and `tailMs >= minTailMs` and `voicedSinceRequest`.

- [ ] **Step 1: Write failing tests**: `1 s with one device`, `2 s with two devices`, `clamped to 3 s with five devices`, `a slow engine stretches the interval` (1 device, service 1100 ms -> 2000), `zero devices count as one`; estimator `first sample initialises`, `smooths with alpha 0.3` (1000 then 2000 -> 1300); gate `not due before the interval`, `not due with less than 0.5 s of tail`, `not due without new voiced audio`, `due again one interval after markRequested`.
- [ ] **Step 2: Run** - FAIL. **Step 3: Implement.** **Step 4: Run** - PASS; lint/typecheck/test green.
- [ ] **Step 5: Commit** `feat(audio): adaptive partial interval and partial gate`.

### Task 7: Fair job queue

**Files:**
- Create: `packages/audio/src/scheduling/transcription-job.ts`, `packages/audio/src/scheduling/fair-job-queue.ts`
- Test: `packages/audio/test/scheduling/fair-job-queue.test.ts`

**Interfaces:**
- Produces:
  - `type JobKind = 'partial' | 'final'`
  - `type TranscriptionJob = { deviceId: string; kind: JobKind; segmentId: number; revision: number; pcm: Uint8Array }`
  - `type DropReason = 'partial-in-flight' | 'finalizing' | 'replaced' | 'superseded' | 'cancelled'`
  - `type Dropped<T> = { entry: T; reason: DropReason }`
  - `class FairJobQueue<T extends { job: TranscriptionJob }> { offer(entry: T): Dropped<T>[]; take(): T | undefined; complete(entry: T): void; removeDevice(deviceId: string): Dropped<T>[]; get size(): number }`
  - Rules: a partial is rejected with `partial-in-flight` when the device's partial is running, with `finalizing` when the device has a final queued or running; otherwise it replaces the device's pending partial (old one `replaced`). A final drops the device's pending partial (`superseded`) and joins the device's final FIFO. `take` serves finals first, then partials; within each class devices are served round-robin in order of first appearance, continuing after the device served last. `removeDevice` drops everything queued for the device (`cancelled`) and forgets it.

- [ ] **Step 1: Write failing tests**: `serves finals before partials`, `keeps finals of one device in order`, `serves finals round-robin across devices`, `serves partials round-robin across devices` (devices a, b, c each offer a partial after every take: served order a, b, c, a, b, c), `rejects a partial while the device's partial is running`, `rejects a partial while the device is finalizing`, `replaces a pending partial with a newer one`, `a final supersedes the pending partial of the same device`, `a pending partial of another device survives a final`, `removeDevice cancels queued jobs`.
- [ ] **Step 2: Run** - FAIL. **Step 3: Implement.** **Step 4: Run** - PASS; lint/typecheck/test green.
- [ ] **Step 5: Commit** `feat(audio): fair per-device job queue`.

### Task 8: Transcription dispatcher

**Files:**
- Create: `packages/audio/src/scheduling/segment-transcriber.ts`, `packages/audio/src/scheduling/job-outcome.ts`, `packages/audio/src/scheduling/transcription-dispatcher.ts`
- Test: `packages/audio/test/scheduling/transcription-dispatcher.test.ts`, `packages/audio/test/support/controllable-transcriber.ts` (fake engine: records calls, each call returns a deferred the test resolves or rejects), `packages/audio/test/support/manual-clock.ts` (`ManualClock implements Clock` with `advance(ms)`)

**Interfaces:**
- Consumes: `FairJobQueue`, `TranscriptionJob`, `DropReason` (Task 7), `ServiceTimeEstimator`, `partialIntervalMs`, `PartialIntervalSource`, `PartialConfig` (Task 6), `Clock` (Task 1).
- Produces:
  - `interface SegmentTranscriber { transcribe(pcm: Uint8Array, signal: AbortSignal): Promise<string> }`
  - `type JobOutcome = { status: 'done'; text: string } | { status: 'dropped'; reason: DropReason } | { status: 'failed'; error: unknown }`
  - `interface JobSubmitter { submit(job: TranscriptionJob): Promise<JobOutcome>; cancelDevice(deviceId: string): void }`
  - `interface DeviceRegistry { attach(deviceId: string, partials: boolean): void; detach(deviceId: string): void }`
  - `class TranscriptionDispatcher implements JobSubmitter, DeviceRegistry { constructor(deps: { transcriber: SegmentTranscriber; clock: Clock; partials?: Partial<PartialConfig> }); partialIntervalSource(): PartialIntervalSource; whenIdle(): Promise<void> }` - one call in flight at a time; service time of every finished call feeds the estimator; `cancelDevice` drops queued jobs and aborts the device's in-flight call (its outcome is `dropped`/`cancelled`); a rejected transcribe resolves `failed`, never rejects `submit`; active devices = attached with `partials: true`.

- [ ] **Step 1: Write failing tests**: `runs one call at a time`, `a final submitted while a partial runs is served next before queued partials`, `drops a partial while the same device's partial is in flight`, `partials of two devices alternate`, `resolves failed when the engine throws`, `cancelDevice aborts the in-flight call and drops queued jobs`, `partial interval grows with attached live devices` (attach a live, b live, c indicator -> 2000 ms), `service time feeds the interval` (one device, a call taking 1100 ms on the manual clock -> 2000 ms), `whenIdle resolves after the queue drains`.
- [ ] **Step 2: Run** - FAIL. **Step 3: Implement** the pump as an async loop started on submit when idle. **Step 4: Run** - PASS; lint/typecheck/test green.
- [ ] **Step 5: Commit** `feat(audio): transcription dispatcher with priority and per-device fairness`.

### Task 9: Rolling session (composition) and end-to-end tests

**Files:**
- Create: `packages/audio/src/session/rolling-session-config.ts`, `packages/audio/src/session/rolling-session.ts`, `packages/audio/src/session/session-errors.ts`
- Test: `packages/audio/test/session/rolling-session.test.ts`, `packages/audio/test/session/rolling-session-fixtures.test.ts`, `packages/audio/test/support/timeline-transcriber.ts` (fake engine whose text is one word per 300 ms block of the job's audio range, read from a sample-range map the test registers per PCM; the first word of a job with lead-in can be inflected to check fuzzy dedup)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `type RollingSessionOptions = { deviceId: string; partials: boolean; submitter: JobSubmitter; registry: DeviceRegistry; interval: PartialIntervalSource; clock: Clock; onEvent: (event: TranscriptEvent) => void; vad?: VoiceActivityDetector; segment?: Partial<SegmentConfig>; minPartialTailMs?: number; msPerOverlapWord?: number }`
  - `class RollingSession { constructor(options: RollingSessionOptions); push(pcm: Uint8Array): void; finish(): Promise<string>; cancel(): void }` - attaches to the registry on construction and detaches on finish/cancel; `push` appends, runs VAD frames through the `Segmenter`, submits a final job per cut (and drops committed audio from the buffer), then asks the `PartialGate` (Živý text only) with `interval.partialIntervalMs()`; `finish` emits the end segment and resolves the full text when every final is in; a failed final rejects `finish` with `SegmentFailedError { segmentId, textSoFar }` after the other finals are in; `cancel` rejects a pending `finish` with `SessionCancelledError`, cancels the device's jobs and ignores late results; `push` after `finish`/`cancel` throws.
  - Export the public API from `src/index.ts`: session, dispatcher, interfaces, configs and defaults, `TranscriptEvent`, `AdaptiveVad`, `Segmenter`, `removeBoundaryDuplicates`, PCM helpers, `systemClock`.

- [ ] **Step 1: Write failing tests** (real dispatcher, VAD, segmenter, assembler; fake engine only):
  - `Indikátor mode never requests partials` (10 s of fixture, partials false: engine saw finals only).
  - `emits partials with increasing revisions about once per second` (one device, manual clock advancing 100 ms per 100 ms frame, engine answering immediately: partial revisions 1, 2, 3 ... about one per second of audio).
  - `a partial in flight at finish does not overwrite the final` (deferred engine: partial started, `finish`, partial resolves after final -> last event is the final).
  - `finish resolves the joined text and final events carry ids 0..n`.
  - `rejects finish with SegmentFailedError keeping the text so far`.
  - `cancel rejects finish and ignores late results`.
  - `two devices both receive partials and their finals come before pending partials` (two sessions on one dispatcher, deferred engine).
  - Fixtures: `continuous speech end to end has no duplicated or missing words` (`speech-continuous` x 3 through the timeline engine with inflected boundary words: final text equals the expected word sequence exactly once), `pause fixture end to end commits at a pause and keeps every word`.
- [ ] **Step 2: Run** - FAIL. **Step 3: Implement.** **Step 4: Run** - PASS; lint/typecheck/test green.
- [ ] **Step 5: Commit** `feat(audio): rolling session composing VAD, segmentation, partials and dispatch`.

### Task 10: Review and report

**Files:**
- Create: `docs/reports/phase-3-audio-report.md`

- [ ] **Step 1:** Run `coderabbit review --agent --base main` in the worktree; fix valid findings with tests (one commit `fix(audio): review findings` if any), note rejected ones with reasons.
- [ ] **Step 2:** Write the report: what was built (module map), test summary (counts, fixtures and provenance), deviations / interpretations (the "Decisions" section above plus anything found while building), CodeRabbit outcome, and "How to wire this into LocalEngine and the gateway" (LocalEngine: one `TranscriptionDispatcher` per engine wrapping `runTranscribeCli` as `SegmentTranscriber`, one `RollingSession` per dictation, `pushAudio` -> `push`, `finish` -> `finish`, events -> overlay; gateway: one dispatcher per STT sidecar shared by all device sessions, `deviceId` = paired device id, partials flag from the client's overlay mode, events -> protocol `partial` / `final` messages).
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test` green; commit `docs: phase 3 audio segmentation report`.
