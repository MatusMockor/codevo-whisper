# Stream F - Gateway live partials report

Date: 2026-10-26. Branch `gateway-partials`. Plan: `docs/plans/2026-10-26-gateway-partials.md`. Spec: sections 4.4, 4.5, 5.3, 5.4, 6, 9, 11 item 6.

## What was built

### Protocol (`packages/protocol`)

- `start` gets an optional field: `{ type: 'start', sessionId, language, partials?: boolean }`.
  - Leaving the field out means `false` (Indikátor).
  - The encoder writes the field only when it is set, so phase-2 frames are byte-identical.
  - The decoder accepts the field missing or boolean and rejects any other value with `bad_message`.
  - Covered by codec tests and two fuzz properties (any JSON value as `partials`, round-trip of booleans).
- `partial` and `final` keep their shapes. Semantics, as told to stream E:
  - `partial` text is the whole tentative text of the open segment, already deduped against the previous final. A higher revision replaces a lower one. Revisions rise per segment but can have gaps.
  - `final` arrives exactly once per segment, in order from 0. Its text can be empty.
  - There are no partials for segment N after final N. A partial for N+1 can arrive before final N.
  - `done` comes after the last final.
  - In Indikátor mode finals already arrive while the user is speaking (a pause cut after about 15 s, a hard cut at 25 s).

### Gateway (`apps/server`)

- **One shared `TranscriptionDispatcher<GatewayContext>`** per STT sidecar, created in `startServer`:
  - `SttSegmentTranscriber` adapts `HttpSttClient` (abort signal, 120 s per-call timeout).
  - Fairness comes from `packages/audio` unchanged: finals before partials, round-robin per device, partial interval `devices x 1 s` clamped to 1-3 s.
  - `TranscriptionQueue`, `FairJobList`, `AudioBuffer`, `chunkAudio` and `transcribeDictation` are deleted, so there is only one queue.
  - `status` reports `dispatcher.pendingJobs()` (new in `packages/audio`).
- **`Dictation`** (`gateway/dictation.ts`) is one `RollingSession` per `start`:
  - context `{ language }`;
  - `partials` taken from `start`;
  - events become `partial`/`final` with `MAX_TEXT_CHARS` applied;
  - `finish` sends `done`, or `error { code, sessionId }`;
  - `cancel` aborts only that session's in-flight call.
- **`SessionHandler`** keeps every phase-2 rule:
  - message rate;
  - frame order and the short-last-frame rule;
  - 600 s per dictation (`too_long`) and the per-device audio budget;
  - idle and hard session expiry.
  - Revoke still closes the sessions; closing cancels the RollingSession, which aborts its running and queued jobs, partials included.
- **Ingestion limit** (`gateway/ingestion-limiter.ts`):
  - a token bucket per device, shared by that device's sessions;
  - 180 s burst, refilled at 1.25 x real time;
  - pushing beyond it closes the session with `bad_message` "audio rate exceeded".
- **Flow control** (`gateway/flow-control.ts`):
  - `flow paused: true` once less than 30 s of the bucket is left;
  - `flow paused: false` once 60 s is available again (checked every 250 ms while paused).
- The dictation log line now has `finals` and `partials` instead of `chunks`.

### STT sidecar (spec 11 item 6)

The pinned transcribe.cpp (`8facde6`) has a stable C API (`transcribe_open`, `transcribe_run`, abort callback), so a resident model is feasible. It is implemented.

- **`native/stt-worker/stt-worker.c`** (about 150 lines, C11):
  - loads the model once with backend and threads, then answers length-prefixed frames on stdin/stdout;
  - request: language length, language, u32 sample count, PCM16;
  - reply: status (`ok`/`failed`/`ready`), u32 length, UTF-8 text;
  - at most 30 s per request.
- **Build:** `native/stt-worker/stt-worker.cmake` is injected with `-DCMAKE_PROJECT_transcribe_INCLUDE` and adds the target through `cmake_language(DEFER)`. The upstream checkout is not patched, and one CMake build produces both `transcribe-cli` and `cw-stt-worker`. A plain `add_subdirectory` does not work, because upstream uses `CMAKE_SOURCE_DIR`.
- **`packages/stt-runner/src/worker/*`:**
  - `ResidentTranscriber` serializes calls and enforces a per-call timeout (default 120 s);
  - abort or timeout kills the worker and starts a new one right away;
  - a crash rejects the call in flight and the next call starts a fresh worker;
  - a reply above 16 000 bytes is rejected;
  - `warmUp()` at startup loads the model before the first dictation.
- **Sidecar:** `STT_ENGINE=worker|cli` (default `worker`). `createTranscriber` picks the strategy, and the CLI path is still available.

### Dev client (`tools/dev-client`)

- `transcribe <wav> [--live]`:
  - `--live` sets `partials: true`, sends 100 ms frames in real time and prints `~ [seg rN] text` and `= [seg] text`;
  - without it, the first 120 s goes at once and the rest in real time, so long files stay under the ingestion limit.

## Tests

- **Protocol:** 92 tests, including the new codec and fuzz cases.
- **Audio:** `pendingJobs` and late-partial tests (192 tests).
- **Server:** 115 tests.
  - New `gateway-live.test.ts`, run with a real gateway, real protocol client and a fake STT HTTP server:
    - Indikátor mode has no partials and finals arrive before `finish`;
    - Živý text has rising revisions, no partial after its final, finals in order and `done` last;
    - partial text capped at `MAX_TEXT_CHARS`;
    - cancel aborts only its own call, and the shared queue moves on to the other device;
    - two live devices: STT `maxActive` is 1, both get partials and no errors;
    - revoke aborts an in-flight partial;
    - a failed segment keeps earlier finals, sends `error` without `done`, and the next dictation is clean;
    - ingestion: pause, reject, resume, a 2-minute retry burst followed by real time, and a bucket shared by one device's sessions.
  - The tests use a manual clock and synthetic voiced bursts with -50 dBFS noise pauses (`test/support/speech.ts`), checked against the real VAD and segmenter.
  - Mutation checks: forcing `partials: false` fails 4 live tests; turning `cancel` into a no-op fails the cancel and both revoke tests.
- **stt-runner:** 16 new tests against a fake worker script with the same framing:
  - reuse, arguments, serialization, abort, a call queued behind an abort, already aborted;
  - crash, timeout, load failure, missing binary, oversized reply, trimming, warm-up.
- **stt:** engine selection through the real sidecar HTTP server with the fake worker; config tests.
- **Dev client:** pacer and flag parsing.
- Whole repo: `pnpm lint`, `pnpm typecheck` and `pnpm test` are green after every commit (908 tests, 1 skipped). Desktop e2e was not run, because no desktop code changed.

## Real-model verification

- **Local, Mac (Metal, Parakeet Ultra Q8_0):** the worker answered warm calls for 12 s of Slovak in 76-85 ms, against 150 ms for `transcribe-cli`, with identical text.
  - Full local stack (sidecar with the worker, gateway, dev client) on 23.7 s of Slovak:
    - Indikátor took 158 ms from finish to text;
    - `--live` printed 22 rising revisions and then the final, about 0.3 s after the end of the audio.
- **Home server:** `codex@192.168.1.110`, compose project `codevo-whisper`, RX 7800 XT Vulkan, Parakeet Ultra F16.
  - Deployed at `258b69b`. The two review fixes that came later (`a8fd62a`, `a54da88`) are covered by tests but not redeployed, because the server had been handed over to stream E for its own smoke test. The `docker compose build` passed (worker compiled and linked with Vulkan, `ldd` check passed). The sidecar logged `engine: worker` and `engine_ready` 0.3 s after start.
  - Per call on 12 s of audio inside the stack:
    - worker 121-147 ms;
    - `transcribe-cli` 535-569 ms, so about 420 ms saved per call.
  - Through the SSH tunnel with the dev client:
    - Indikátor: 12 s took 321 ms and 23.7 s took 183 ms from finish to text (phase 2 was about 600 ms for 6.7 s);
    - `--live` on 23.7 s: 22 partials, then the final, with the whole run taking 23.97 s.
  - Afterwards the device was revoked, `transcribe` returned `unknown_device`, no pairing window was left open, no device is paired, and the other 11 containers were not touched.

## Deviations and decisions

- **Flow semantics changed.** Phase 2 paused the client after 300 s of buffered audio and resumed only at idle. Audio is no longer buffered until finish, so `flow` now reflects the ingestion bucket (pause below 30 s left, resume at 60 s). A cooperative client that sends in real time never sees it. The 300 s constant is gone.
- **Burst of 180 s, not 150 s as first planned.** A full 2-minute retry replay (spec 5.4) would have left exactly the 30 s pause mark. 180 s keeps 60 s of headroom. The cap is still well below "much faster than real time": at most 180 s plus 1.25 x the elapsed time.
- **No queue wait timeout and no per-device job cap.** The old 30 s wait timeout and the 4-jobs-per-device cap answered `busy`. The dispatcher never drops finals and keeps one pending partial per session. Queued work per device is bounded by the 600 s audio budget and the ingestion limit, and spec 6 requires that no busy error reaches a client.
- **A failed segment emits an empty `final` before `error`.** That is the audio package rule ("every segment gets exactly one final"). Tests pin it: for example, a 500 from the STT on one segment gives `final { text: '' }` and then `error stt_unavailable`.
- **Model in the context.** The context is `{ language }`. `start` carries no model and the sidecar serves one model, so `model` (optional in `TranscriptionContext`) is not set.
- **The worker aborts by being killed, not through the abort callback.** A signal-driven abort flag races with the reply of the next request. Kill and respawn is simple and robust, and the replacement loads in about 0.3 s. Cancels are rare, because partials are never aborted except on cancel or revoke.

## Reviews

- CodeRabbit (`coderabbit review --agent --base main`, free allowance): 0 findings on 68 files. It was run again after the review fixes: one rate-limit wait, then 0 findings.
- gpt-6.1-sol (`codex exec -s read-only`) on the whole branch: three P2 findings. Each was reproduced with a failing test first and then fixed:
  1. **Late partials after `done`.** Scenario: speech, then a silent tail after a pause cut. The end segment is skipped, so the open segment is never committed, and its in-flight partial was emitted after `finish` resolved.
     - Fix in `RollingSession` (`a8fd62a`): partial results are accepted only while recording, and completion calls `cancelSession`, which aborts the leftover partial so the engine is free.
     - Test: `a partial of a silent tail that is never committed is not emitted after finish`.
  2. **`ResidentTranscriber.close()` let queued calls start a new worker.** Calls and `warmUp` now reject once closed, and `close` waits for the worker to exit.
  3. **A worker that died while idle failed the next call.** `current()` now replaces a dead worker before sending.
  - Tests: `close rejects queued and later calls and starts no new worker`, `replaces a worker that died while idle before the next call`.
- Re-review of the fixes (`a8fd62a`, `a54da88`) by gpt-6.1-sol: no findings. It also re-ran the lifecycle and silent-tail scenarios itself.

## Open items

- Desktop live-text UI (Živý text overlay) and the RemoteEngine `partials` flag belong to stream E.
- LocalEngine could reuse `ResidentTranscriber` with the macOS worker build (`native/stt-worker` builds with Metal through the same include hook). That is out of scope here.
- The image now has two engine binaries from one configure and build of the pinned commit (`transcribe-cli` for `STT_ENGINE=cli`, `cw-stt-worker`). The worker binary adds 49 MB to the image.
