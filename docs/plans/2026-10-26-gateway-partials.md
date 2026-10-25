# Gateway Partials (Stream F) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The gateway streams audio into `packages/audio` (RollingSession + one shared TranscriptionDispatcher) and sends live `partial`/`final` messages, with an ingestion rate limit and, if feasible, a resident STT model.

**Architecture:** `apps/server` creates one `TranscriptionDispatcher<GatewayContext>` per STT sidecar in `startServer`. An `SttSegmentTranscriber` adapts `HttpSttClient` to `SegmentTranscriber`. `SessionHandler` creates one `RollingSession` per dictation and maps its events to protocol messages. The old `TranscriptionQueue`, `FairJobList`, `AudioBuffer`, `chunkAudio` and `transcribeDictation` are deleted, so only one queue is left. A per-device `IngestionLimiter` (a token bucket in audio seconds) caps how fast audio comes in. `flow` messages are now driven by how much of that bucket is left.

**Tech Stack:** TypeScript, Node 24, ws, vitest, pnpm workspaces; C (transcribe.cpp C API at commit 8facde6) for the resident STT worker.

**Spec:** `docs/specs/2026-10-25-codevo-whisper-design.md` (sections 4.4, 4.5, 5.3, 5.4, 6, 9, 11 item 6). Integration notes: `docs/reports/phase-3-audio-report.md` ("How to wire", review fixes).

## Global Constraints

- The protocol change is backwards compatible. `start` gets an optional `partials: boolean`, and leaving it out means `false` (Indikátor). No new error codes.
- Partials are sent only when `partials: true` (spec 5.3). Finals go before partials, the queue is round-robin per device, and the partial interval is `devices x 1 s` clamped to 1-3 s. All of this comes from `packages/audio` and is not re-implemented.
- These phase-2 limits stay as they are:
  - pre-auth limits and frame size;
  - message rate `{ burst: 1000, perSecond: 200 }`;
  - 600 s of audio per dictation (`too_long`) and the per-device audio budget;
  - session expiry (600 s idle, 1 800 s hard);
  - revoke closes the session and aborts its in-flight STT call;
  - `MAX_TEXT_CHARS` is applied to every outgoing text.
- The ingestion limit is per device and shared by its sessions:
  - burst 150 s of audio, which is more than the 2-minute client retry buffer from spec 5.4;
  - refill at 1.25 x real time;
  - `flow paused` when less than 30 s is left, `flow resumed` once 60 s is available again;
  - when the bucket runs out the session fails with `bad_message` "audio rate exceeded".
- Owner rules apply: no code comments, no `else`, small files, real collaborators in tests, and only the STT HTTP server and the worker process may be faked.

## Review Focus

- A client that never sends `partials` (phase-2 client) must get exactly the old message shapes: finals in order from 0, then `done`. The legacy tests stay green with the field left out.
- A cancel or disconnect during an in-flight partial must not leak a `partial` or `final` of that dictation into the next one. Covered by the cancel test with a held STT call, followed by a new dictation on the same connection.
- A revoked device's in-flight partial is aborted, not only its final. Covered by a revoke test with `partials: true`.
- A burst of exactly the 2-minute retry buffer followed by real-time audio must never be rejected. Covered by an ingestion test that sends 120 s at once, then 1 s per 1 s for 60 s.
- If an STT failure mid-dictation is only reported at finish, the finals already sent still stand and no `done` follows the `error`. Covered by a test where the second segment fails.

---

### Task 1: Protocol `start.partials`

**Files:** Modify `packages/protocol/src/message-types.ts`, `packages/protocol/src/client-messages.ts`. Test `packages/protocol/test/messages.test.ts`, `packages/protocol/test/fuzz.test.ts`.

**Interfaces:** Produces `{ type: 'start'; sessionId: string; language: Language; partials?: boolean }`. The encoder writes the field only when it is defined. The decoder accepts it missing or boolean and rejects anything else.

- [ ] Tests:
  - round-trip with `partials: true`, with `partials: false` and without the field (decodes without the key);
  - `partials: 'yes'`, `1` and `null` are rejected with `bad_message`;
  - fuzz: start frames whose `partials` is any `fc.jsonValue()` throw only `ProtocolError`, and boolean ones round-trip.
- [ ] Implement, run `pnpm vitest run packages/protocol`, commit `feat(protocol): optional partials flag on start`.

### Task 2: Dispatcher pending count

**Files:** Modify `packages/audio/src/scheduling/transcription-dispatcher.ts`. Test `packages/audio/test/scheduling/transcription-dispatcher.test.ts`.

**Interfaces:** Produces `TranscriptionDispatcher.pendingJobs(): number`, which is queued plus running jobs. It replaces `TranscriptionQueue.size()` in admin `status`.

- [ ] Test: 0 when idle, 2 with one running and one queued final, 0 after `whenIdle()`. Implement and commit `feat(audio): dispatcher pending job count`.

### Task 3: Ingestion limiter

**Files:** Create `apps/server/src/gateway/ingestion-limiter.ts`. Modify `apps/server/src/gateway/limits.ts` (add `INGESTION_LIMITS`). Test `apps/server/test/ingestion-limiter.test.ts`.

**Interfaces:** Produces:
- `type IngestionLimits = { burstSeconds: number; realTimeFactor: number; pauseBelowSeconds: number; resumeAboveSeconds: number }`
- `class IngestionLimiter { constructor(clock: () => number, limits: IngestionLimits); take(deviceId: string, bytes: number): boolean; availableSeconds(deviceId: string): number }`

- [ ] Tests:
  - a frozen clock allows exactly 150 s and rejects the next byte;
  - after 10 s of clock time, 12.5 s more is allowed;
  - two device ids are independent;
  - the bucket never grows above the burst.
- [ ] Implement and commit `feat(server): per-device audio ingestion limiter`.

### Task 4: Shared dispatcher and live session handler

**Files:**
- Create `apps/server/src/stt/stt-segment-transcriber.ts`, `apps/server/src/gateway/dictation.ts` (one RollingSession plus the event-to-message mapping) and `apps/server/src/gateway/flow-control.ts` (pause/resume hysteresis with a 250 ms resume check while paused).
- Modify `apps/server/src/app.ts`, `gateway.ts`, `connection.ts`, `session-handler.ts`, `dictation-log.ts`, `admin/admin-commands.ts`, `apps/server/package.json` (add `@codevo-whisper/audio`).
- Delete `src/stt/transcription-queue.ts`, `fair-job-list.ts`, `transcription-job.ts`, `chunk-audio.ts`, `src/gateway/audio-buffer.ts`, `transcribe-dictation.ts` and their tests.
- Tests: `apps/server/test/gateway-session.test.ts` (adapted), new `apps/server/test/gateway-live.test.ts`, new support `test/support/speech.ts` (synthetic voiced bursts at -12 dBFS with 300 ms pauses at -50 dBFS noise, so the adaptive VAD sees speech and pauses). Fake STT gets `delayFor(pcm)`.

**Interfaces:**
- `type GatewayContext = { language: Language }`
- `type GatewayDispatcher = TranscriptionDispatcher<GatewayContext>`
- `SessionDeps = { dispatcher; clock; logger; budget; ingestion: IngestionLimiter; flowLimits: IngestionLimits }`
- `ServerOptions.ingestion?: Partial<IngestionLimits>`; `RunningServer.dispatcher` replaces `queue`.

- [ ] Tests (gateway-live):
  - Indikátor mode with 20 s of speech paced on a manual clock: no `partial` at all, final 0 arrives before `finish` is sent, then final 1, then `done`;
  - Živý text: at least 2 partials, revisions strictly rising per segment, no partial for segment N after final N, finals 0..n in order, `done` last, every text at most `MAX_TEXT_CHARS`;
  - cancel while the STT call is held: the fake STT counts 1 aborted call, the client gets `done`, and the next dictation's messages carry only the new session id;
  - two devices in live mode: both get partials and finals, the fake STT `maxActive()` is 1, and no `busy` or `error` reaches either client;
  - revoke during a live partial aborts the call;
  - the second segment fails with 500: final 0 is sent, then `error stt_unavailable` with the sessionId, and no `done`.
- [ ] Ingestion tests:
  - a frozen clock with 121 s sent gives `flow paused: true`; sending past 150 s gives `error bad_message`;
  - with a paused bucket, advancing the clock 60 s gives `flow paused: false`;
  - 120 s at once followed by 60 x 1 s paced stays healthy;
  - two sessions of one device share the bucket.
- [ ] Adapt the legacy tests: anything that pushed 301 s or 601 s at once now pushes 10 s chunks with the clock advanced 10 s per chunk. The 60 s chunking test becomes "commits segments while speaking". The 300 s flow test is replaced by the ingestion flow tests.
- [ ] Implement, run `pnpm lint && pnpm typecheck && pnpm test`, commit `feat(server): stream dictations through the shared rolling dispatcher`.

### Task 5: Dev client `--live`

**Files:** Modify `tools/dev-client/src/transcribe.ts`, `main.ts`. Create `tools/dev-client/src/audio-pacer.ts`. Test `tools/dev-client/test/audio-pacer.test.ts`.

**Interfaces:** `pacedFrames(pcm, { frameMs: 100, burstSeconds }): Array<{ atMs: number; pcm: Uint8Array }>`. The first `burstSeconds` of audio is sent at time 0 and the rest in real time. `--live` sets `partials: true` and `burstSeconds: 0`, and prints `~ [seg r<rev>] text` for each partial and `= [seg] text` for each final.

- [ ] Pacer tests: timings for burst 0 and burst 120, and the last frame is shorter. Implement and commit `feat(dev-client): live partials and real-time pacing`.

### Task 6: Resident STT worker (spec 11 item 6)

The pinned transcribe.cpp has a stable C API (`transcribe_open`, `transcribe_run`, `transcribe_set_abort_callback`), so a resident model is feasible.

**Files:**
- Create `native/stt-worker/stt-worker.c` and `CMakeLists.txt`. The worker loads the model once and runs a stdin/stdout loop with length-prefixed frames (request: language plus PCM16; reply: status plus UTF-8 text).
- Create `apps/stt/src/worker-transcriber.ts`, which spawns the worker once, sends one request at a time, restarts the worker after a crash or abort, and applies a per-call timeout.
- Modify `apps/stt/src/main.ts`, `config.ts` (`STT_ENGINE=worker|cli`, default `worker`) and `apps/stt/Dockerfile` (build the worker against the pinned commit).
- Test `apps/stt/test/worker-transcriber.test.ts` against a fake worker script that speaks the same framing.

- [ ] Tests:
  - two calls reuse one process;
  - abort kills the worker and the next call starts a new one;
  - a crash rejects the call in flight and the next call recovers;
  - a timeout rejects.
- [ ] Verify locally: build the worker on macOS against the pinned commit (Metal), transcribe the Slovak sample twice and compare the warm call time with the CLI.
- [ ] Commit `feat(stt): resident transcribe.cpp worker`. If the native build is not feasible, document that in the report instead.

### Task 7: Deploy, smoke test, review, report

- [ ] Optionally redeploy on `codex@192.168.1.110` (compose project `~/Developer/codevo-whisper`, touch only its containers). Pair the dev client, run `--live` on the Slovak sample, then revoke the device.
- [ ] Run `coderabbit review --agent --base main` and fix the valid findings.
- [ ] Write `docs/reports/2026-10-26-gateway-partials-report.md` and commit it.
