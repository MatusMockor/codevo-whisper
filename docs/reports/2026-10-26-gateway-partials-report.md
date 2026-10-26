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
  - `SttSegmentTranscriber` adapts `HttpSttClient` (abort signal, 40 s per-call timeout; one retry after a 503), wrapped in `DeviceGuardedTranscriber` (see the hardening round).
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
  - each request carries at most 30 s of audio (480 000 samples).
- **Build:** `native/stt-worker/stt-worker.cmake` is injected with `-DCMAKE_PROJECT_transcribe_INCLUDE` and adds the target through `cmake_language(DEFER)`. The upstream checkout is not patched, and one CMake build produces both `transcribe-cli` and `cw-stt-worker`. A plain `add_subdirectory` does not work, because upstream uses `CMAKE_SOURCE_DIR`.
- **`packages/stt-runner/src/worker/*`:**
  - `ResidentTranscriber` serializes calls, enforces a 30 s per-call timeout and a 120 s startup deadline;
  - an abort rejects the caller at once. The worker is killed only if it has not answered within a 2 s grace, and a timeout kills it at once. Either way a new worker starts lazily on the next call, with exponential backoff;
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
- **The worker aborts by being killed, not through the abort callback** (refined in the hardening round below). A signal-driven abort flag races with the reply of the next request. Kill and respawn is simple and robust, and the replacement loads in about 0.3 s. Cancels are rare, because partials are never aborted except on cancel or revoke.

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

## Hardening round

After the Claude and gpt-6.1-sol reviews, 2026-10-26. Plan: section "Hardening round" in `docs/plans/2026-10-26-gateway-partials.md`. Each item was written test-first where it has logic, in one commit per item.

### 1. Worker restarts (`6de437b`, `92cb7d0`)

- **Normal completion no longer aborts anything.**
  - `RollingSession.complete` calls the new `JobSubmitter.dropQueued(sessionId)` (`FairJobQueue.removeQueued`), which settles only queued jobs as dropped.
  - A running partial finishes, and its result is ignored because partial results are accepted only while recording.
- **`ResidentTranscriber`:**
  - An abort rejects the caller at once. The worker keeps a 2 s grace (`abortGraceMs`) to answer; a reply in time keeps the process.
  - Only after the grace is the worker killed. Respawn is lazy, on the next call and after `terminated`, with an exponential backoff (500 ms x 2^(n-1), at most 30 s, reset by a successful call).
  - A killed worker no longer counts as alive before its `close` event, so it is never reused.
- **Per-device caps in the gateway** (`DeviceGuardedTranscriber`, a `SegmentTranscriber` decorator over a shared `KeyedTokenBucket`):
  - started inferences: burst 30, refill 4/s; above that the call fails with `busy`;
  - forwarded aborts of running calls: burst 5, refill 1/min; above that the abort is not forwarded, and the call runs to the end and is ignored. This bounds the worker restarts one device can cause.
- **Tests:**
  - queue, dispatcher and session tests for `dropQueued`;
  - the silent-tail partial is neither emitted nor aborted;
  - worker tests for: abort after the grace (lazy respawn, spawn count), a reply within the grace keeps the pid, a call queued behind an abort, backoff gaps of at least 100/200/400 ms that reset after a success, and a worker that died while idle;
  - gateway tests for the inference cap (the 31st dictation of one device gets `busy`, another device is unaffected) and the abort cap (the 6th cancel is not forwarded, the fake STT counts 5 aborts).

### 2. Hung engine (`92cb7d0`, `6de437b`)

- The worker's per-call timeout is 30 s (`RESIDENT_DEFAULTS.timeoutMs`). Waiting for `ready` counts against a separate 120 s startup deadline.
- The gateway's HTTP timeout is 40 s, so the sidecar times out first.
- **After the first failed final, the session stops:**
  - its queued finals are dropped;
  - later commits are not submitted, and partials stop;
  - every segment still gets one (empty) final, and `finish` rejects once, so the client gets one `error`.
  - Test: `after the first failed final the session skips its remaining finals and partials` (a mutation check without the skip fails it).
  - Changed test: `rejects finish with SegmentFailedError keeping the text so far` now keeps the text of finals that succeeded before the failure.

### 3. 503 right after an abort (`74d463b`)

`SttSegmentTranscriber` retries a `busy` (503) once after 250 ms, unless the job was aborted. Test: the first sidecar answer is 503 and the client still gets `final` and `done`. With an STT that keeps answering 503, the client still gets `busy` after the one retry.

### 4. Health (`4583584`, `92cb7d0`)

- `Transcriber.ready()`; the CLI engine is always ready.
- `/health` answers `503 { status: 'DOWN' }` until the resident worker answered `ready`. A worker that failed to start or crashed makes it `DOWN` again until the next successful start.
- `warmUp()` applies the 120 s startup deadline and kills a worker that misses it.
- The image healthcheck `start-period` is 120 s.
- Tests: DOWN before warm-up and UP after it (through the real sidecar HTTP server); not ready before `ready`; a missed startup deadline kills the worker and the next call recovers.

### 5. Gateway HTTP client (`2e3044d`)

- The sidecar response is read through a stream reader capped at 128 KiB:
  - a declared `Content-Length` above the cap is refused up front;
  - a chunked body is cancelled as soon as it passes the cap.
- The body is decoded as fatal UTF-8, then parsed as JSON.
- Text longer than `MAX_TEXT_CHARS` (16 000 characters) is rejected with `stt_unavailable` before it reaches the assembler. `limitText` stays on the outgoing side, because a carried word can be added to a final.
- Tests: chunked 192 KiB body without `Content-Length`, oversized `Content-Length`, invalid UTF-8, 16 000 accepted and 16 001 rejected. Gateway-level tests were adjusted: text at the limit passes, longer text gives an empty final and `stt_unavailable`.

### 6. Compose (`5bf3e25`)

- **Both services:**
  - `read_only`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `ulimits.core: 0`;
  - `mem_limit` (stt `4g`, gateway `512m`; overridable with `STT_MEM_LIMIT`, `GATEWAY_MEM_LIMIT`);
  - `cpus` (4 / 2), `pids_limit` (128 / 64), `ulimits.nofile` (1024 / 4096).
  - Measured idle use on the server: stt 159 MiB / 23 PIDs, gateway 48 MiB / 11 PIDs.
- **GPU:** `stt` gets only one render node: `STT_RENDER_DEVICE` (default `/dev/dri/renderD128`) is mapped to `/dev/dri/renderD128`, with `group_add` of `RENDER_GID` only (`VIDEO_GID` is no longer needed).
  - The server has two GPUs: `pci-0000:03:00.0-render -> renderD128` is the RX 7800 XT and `renderD129` is the integrated Radeon. So the narrowing also pins Vulkan to the discrete card.
  - How to find the node (`lspci`, `/dev/dri/by-path/`) is documented in `docs/operations/server-setup.md`.
- **Models:** `cw-models:/models:ro` at runtime. Provisioning is the separate `stt-provision` service (profile `provision`, read-write volume, same hardening): `docker compose --profile provision run --rm stt-provision`.

### 7. C worker hardening (`8ef5b9c`)

- **Parser:** moved to `native/stt-worker/stt-worker-request.c` (`cw_parse_header`, `cw_decode_samples`) and independent of stdin and the model.
  - Language whitelist with exact length: `''`, `sk`, `en`, `cs`. An embedded NUL, uppercase and lengths of 1, 3, 15, 16 or 255 bytes are rejected.
  - At most 30 s of audio per request (480 000 samples); 480 001 and `UINT32_MAX` are rejected.
  - Portable int16 conversion.
- **Process behaviour:**
  - An invalid request replies `failed` and exits 3, and a truncated frame exits 3; only the end of input at a frame boundary exits 0.
  - `--threads` must be a full integer in 1..256 and the backend is whitelisted (exit 2 otherwise).
  - Transcripts above 16 000 bytes reply `failed`.
  - `stdout` is moved to `stderr` with `dup2` at startup, and replies go to a private duplicate of the original fd, so stray library prints cannot corrupt the framing.
- **Node side:** the language is validated before encoding (`RangeError`), requests above 480 000 samples are refused without touching the worker, and replies are decoded as fatal UTF-8.
- **Build flags:** for every object, transcribe.cpp and ggml included: `-O2 -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3 -fstack-protector-strong -fPIE` with `CMAKE_POSITION_INDEPENDENT_CODE=ON`, and links with `-pie -Wl,-z,relro,-z,now,-z,noexecstack`.
- **`check-elf-hardening.sh`** runs in the image build and fails it when PIE, BIND_NOW, GNU_RELRO, a non-executable stack or fortified calls are missing. Output from the server build at `6ef0d38` (Debian trixie, gcc 14):

```
== /opt/transcribe/bin/transcribe-cli
  Type:                              DYN (Position-Independent Executable file)
 0x000000000000001e (FLAGS)              BIND_NOW
 0x000000006ffffffb (FLAGS_1)            Flags: NOW PIE
  GNU_STACK      0x000000 0x0000000000000000 0x0000000000000000 0x000000 0x000000 RW  0x10
  GNU_RELRO      0x2d628c0 0x0000000002d638c0 0x0000000002d638c0 0x007740 0x007740 R   0x1
fortified symbols: 14
== /opt/transcribe/bin/cw-stt-worker
  Type:                              DYN (Position-Independent Executable file)
 0x000000000000001e (FLAGS)              BIND_NOW
 0x000000006ffffffb (FLAGS_1)            Flags: NOW PIE
  GNU_STACK      0x000000 0x0000000000000000 0x0000000000000000 0x000000 0x000000 RW  0x10
  GNU_RELRO      0x2d46a00 0x0000000002d47a00 0x0000000002d47a00 0x007600 0x007600 R   0x1
fortified symbols: 14
```

- **Tests:**
  - `native/stt-worker/test/request-test.c` with ASan and UBSan (`test/run-tests.sh`). It also runs inside the image build with gcc.
  - `native/stt-worker/test/worker-smoke.js`, a black-box run of the real binary with a real model, passes 12/12:
    - on macOS with Metal;
    - inside the hardened image on the server with Vulkan, as `docker compose exec -T stt node --input-type=module - <worker> <model> <pcm> vulkan < native/stt-worker/test/worker-smoke.js`.

### 8. Fuzzing (`6ef0d38`)

- `native/stt-worker/fuzz/request-fuzzer.c` is a libFuzzer target with ASan and UBSan (`-fno-sanitize-recover=all`). It parses consecutive frames, decodes the samples and aborts if a parsed header breaks an invariant (sample bound, header size, whitelist).
- The seed corpus (`make-corpus.py`) covers:
  - languages of 0, 15, 16 and 255 bytes, and an embedded NUL;
  - sample counts 0, 480 000, 480 001 and `UINT32_MAX`;
  - truncated headers and bodies, concatenated frames, and concatenated frames that end truncated.
- `native/stt-worker/fuzz/run-fuzz.sh` builds a throwaway Debian trixie + clang image and runs it with `--network none`, a read-only root, `--cap-drop ALL`, a 2 GiB memory limit and 1 CPU. `FUZZ_SECONDS` defaults to 600, and the image is removed afterwards.
- **Result:** 600 s on Docker Desktop (arm64 Linux VM), `Done 655240832 runs in 601 second(s)`, about 1.09 M exec/s, 635 new units, final corpus 64 units, coverage 29 edges (the whole parser), peak RSS 588 MB. No crash, sanitizer report or timeout.

### 9. Hygiene and server version (`94b835a`, `998e00d`)

- `native/stt-worker/build-macos.sh` builds the Metal worker that produced the local numbers above. It fetches the pinned commit and uses the same include hook with `-O2 -fstack-protector-strong`; macOS has no ELF hardening flags.
- `apps/server` is now version 0.2.0, imported from `package.json`. `ready.serverVersion` and `status` report it, and the `ready` shape is unchanged.
  - Test: `ready.serverVersion` equals the package version.
  - Stream E uses the version to tell a phase-2 gateway (flow resumes only after finish) from this one (flow follows the ingestion budget).

### Redeploy and smoke test

- Home server, compose project `codevo-whisper`, at `6ef0d38`:
  - the build passed, including the C unit test and the `readelf` gate;
  - both containers are `healthy`, and the stt logged `engine_ready` 0.3 s after `listening`;
  - inside `stt`, `/dev/dri` has only `renderD128`, `CapEff` is 0, `NoNewPrivs` is 1 and `/models` is read-only;
  - `docker inspect` shows the memory, CPU and PID limits and the read-only root;
  - `status` reports version 0.2.0;
  - `stt-provision` verified the existing model.
- Dev client over the SSH tunnel on 23.7 s of Slovak:
  - Indikátor took 456 ms on the first call after the restart (first Vulkan run) and 224 ms warm;
  - `--live` sent 22 partials and then the final.
- The device was revoked afterwards, `transcribe` returned `unknown_device`, no pairing window or device is left, and the other 11 containers were not touched.

### Tests and reviews

- Whole repo after the round: `pnpm lint`, `pnpm typecheck` and `pnpm test` are green (932 passed, 1 skipped).
- CodeRabbit (`coderabbit review --agent --base main`) on the hardened branch: 1 minor finding, stale timeout and restart descriptions in the early sections of this report. Fixed in the same commit as this section.
