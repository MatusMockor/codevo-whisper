# Phase 2 - Protocol + Server Core: report

Branch `phase-2-protocol-server` (worktree `~/Developer/codevo-whisper-phase2`), based on `main` at `211c2e0`. Plan: `docs/plans/2026-10-25-phase-2-protocol-server.md`. Spec: `docs/specs/2026-10-25-codevo-whisper-design.md`. Not pushed, nothing committed to `main`.

## Summary

All 10 implementation tasks are done, plus fixes for 9 security findings from the automated reviews (5 from the controller's review, 4 from gpt-6.1-sol). `pnpm lint`, `pnpm typecheck` and `pnpm test` pass after every commit. At the end the whole workspace has 515 passing tests and 1 skipped (the skipped one is from phase 1 desktop). Phase 2 packages:

| Package | Tests |
|---|---|
| `packages/protocol` | 84 |
| `apps/server` | 92 |
| `apps/stt` | 17 |
| `tools/dev-client` | 7 |
| `packages/stt-runner` (phase 1, reused) | 14 |

The home server smoke test passed end to end: build, provision, healthy services, `127.0.0.1:8787` only, pairing over an SSH tunnel, the exact Slovak transcript, and `unknown_device` after revoke.

## Per task

### Task 1 - Monorepo scaffold (`c51e959`)

The monorepo, lint, typecheck and test setup already existed from phase 1, so only `packages/protocol` was added: package, tsconfig and Vitest project with the same layout as `packages/stt-runner`. The new packages are picked up by the existing root `projects` globs (`apps/*`, `packages/*`, `tools/*`), so the root Vitest config did not change.

- Test: `smoke.test.ts` (`PROTOCOL_VERSION === 'cw1'`).
- TDD: failed first (`PROTOCOL_VERSION` missing), then passed.

### Task 2 - Noise IK and IKpsk2 (`07515d3`)

Built from scratch per Noise rev 34 sections 5 and 9, on top of `@noble/curves` X25519, `@noble/ciphers` ChaCha20-Poly1305 and `@noble/hashes` BLAKE2s and HMAC (all 2.4.0):

- `primitives.ts`: DH, hash, HKDF (HMAC-BLAKE2s, 2 or 3 outputs), encrypt and decrypt with a 96-bit nonce (4 zero bytes followed by a 64-bit little-endian counter).
- `cipher-state.ts`: bigint nonce. Throws `NoiseError` at 2^64-1. `rekey()` = ENCRYPT(k, 2^64-1, empty, zeros).
- `symmetric-state.ts`, `handshake-state.ts`, `patterns.ts` (token lists, pre-message `<- s`). For psk patterns the `e` token also runs MixKey.
- Handshake state: enforces turn order, fails for good after an error, caps messages at 65,535 bytes and validates key and psk lengths.
- Vectors: `test/vectors/noise-vectors.json`, taken from cacophony `vectors/cacophony.txt` at commit `8ee9d41e34a1a596cfa3ab12aa4069ff87dc1247` (file SHA-256 recorded in `source`). The file has exactly 2 vectors for these protocol names (IK and IKpsk2). Both replay all 6 messages: 2 handshake messages and 4 transport messages through the split ciphers. Both match the handshake hash.
- Tests (19 in this task): vectors; tampered, truncated, wrong psk, wrong prologue and wrong responder key all rejected; initiator static key exposed to the responder; turn order; no reuse after a failure; option validation; CipherState nonce limit, plaintext passthrough without a key, no nonce advance after a failed decrypt, rekey.
- TDD: failed first (modules missing), then passed.

### Task 3 - Secure transport, framing, messages (`5455872`)

- `SecureTransport`: counts messages per direction and rekeys every `REKEY_EVERY` (10,000) messages. A plaintext over 65,519 bytes or a ciphertext over 65,535 bytes is rejected. Authentication failures become `ProtocolError('bad_message')`.
- Opening frame: 1 mode byte (`Pair = 0x01`, `Session = 0x02`) followed by the Noise message. Prologues `cw1/pair` and `cw1/session`.
- Messages: byte 0 is the tag. `0x01` = UTF-8 JSON with a `type` field, `0x02` = raw PCM (`audio`). Validation is written by hand: unknown fields, unknown types, invalid UTF-8 or JSON, odd or empty audio, `deviceName` longer than 64 characters or containing control characters (so the operator terminal cannot be injected into), invalid `sessionId` and invalid language are all rejected.
- Fuzzing (`fast-check` 4.10.2): 10,000 random byte arrays and 10,000 random JSON frames each into `decodeOpeningFrame`, `decodeClientMessage` and `decodeServerMessage`. Task 4 added 10,000 random strings into `parsePairingToken`. Every decoder throws only `ProtocolError('bad_message')`.
- TDD: failed first, then passed.

### Task 4 - Pairing token and fingerprint (`7d9572d`)

`cw1:<key b64url>:<secret b64url>:<encodeURIComponent(endpoint)>`. Base64url must be canonical (no padding, the bytes must re-encode to the same text). Key must be 32 bytes, secret 32 (used directly as the Noise psk, controller ruling after review), endpoint `ws:` or `wss:`. `fingerprint` = the first 16 bytes of BLAKE2s as 8 groups of 4 uppercase hex characters (tested against the known BLAKE2s("") value). TDD: failed first, then passed.

### Task 5 - Config, key store, device registry (`e89fbfa`)

- `loadConfig` uses the plan's defaults and validates the port, `CW_STT_URL` (http/https) and `CW_PUBLIC_ENDPOINT` (ws/wss).
- `ServerKeyStore`: `server-key.json` is written atomically with mode 0600. Loading refuses group or other permission bits and a public key that does not match the private key.
- `FileDeviceRepository`: `devices.json` with mode 0600 and an atomic write (temp file, fsync, rename). Operations run one at a time. Device id = the first 8 hex characters of BLAKE2s(publicKey). Same key twice returns the existing device.
- Tests use real temp directories, including a stray temp file left by a "crash" and concurrent additions.
- TDD: failed first, then passed.

### Task 6 - STT client and transcription queue (`7e58161`)

- `HttpSttClient` maps 503 to `busy`. Any other non-2xx, a network error, a timeout or a malformed body maps to `stt_unavailable`. An abort coming from the caller's signal is passed through as is. It also implements `SttHealthCheck` for `status`.
- `TranscriptionQueue` runs one job at a time and picks the next device round robin (the device that ran last goes behind the others). A job that waits longer than `waitTimeoutMs` fails with `busy`. `cancelDevice` rejects waiting jobs and aborts the running one.
- `chunkAudio`: chunks of at most 25 s, never splitting a sample, dropping a tail under 640 bytes.
- Fake: `test/support/fake-stt-server.ts`, a real HTTP server on port 0 that implements the sidecar contract. It also counts aborted requests and the maximum number of concurrent requests.
- TDD: failed first, then passed.

### Task 7 - Encrypted gateway sessions (`5f91614`, replay fix `72a2652`)

- `ws` with `perMessageDeflate: false`, `maxPayload: 65536` and `maxFragments: 1`. Text frames close with 1003, oversized frames with 1009, fragmented messages with 1008.
- Per TCP connection, before the upgrade: a pre-auth limiter slot (64 pending in total, 4 pending per IP, 8 connections per IP) and a handshake deadline (5 s). Then the opening frame and IK or IKpsk2 as responder.
- An unknown device key closes the connection with `unknown_device` before the server's handshake reply. Handshake payloads must be empty.
- Session flow: `ready`, `start`, `audio`*, `finish`, `final` per 25 s chunk (`segmentId` from 0), `done`. Order is enforced, a second dictation per connection is allowed after `done`, and `cancel` drops the audio and aborts the queued jobs of that dictation. Sessions are closed after 600 s (`session_expired`, checked against the injected clock on every message and by a timer). More than 600 s of audio gives `too_long`. Above 300 s of buffered audio the server sends `flow { paused: true }`, and `paused: false` once the buffer is released.
- Error codes are mapped to WebSocket close codes 4000 + index (`closeCodeFor` / `errorCodeForClose` in the protocol package). After the handshake the error is also sent encrypted.
- `main.ts` logs one JSON line per dictation (device id, audio seconds, chunk count, duration, result).
- Tests: all cases from the plan, plus audio while finishing, a wrong server key, a garbage opening frame, the per-IP connection limit and closing sessions when the gateway closes. The ciphertext test runs through a TCP proxy. The test client uses a zero WebSocket mask, so a plaintext leak would be visible in the recording; this was checked separately.
- TDD: failed first, then passed.

### Task 8 - Pairing, admin socket, CLI (`58b08ab`, hardening `db7d693`)

- `WindowPairingService`: one window at a time with a 10 minute default. The window is consumed only when the first `pair-request` decrypts, which is the first proof that the client holds the psk. Then the admin connection that opened the window is asked to decide.
- The window closes when a device is paired or rejected, when it expires (also checked against the injected clock), when the admin connection drops, on rotate-key and after 20 failed attempts. An IP with 5 failed attempts is refused for the rest of the window.
- Admin socket: JSON lines, the commands and events from the plan, with input validation.
- CLI `codevo-whisper pair|devices|revoke|rotate-key|status` with the Slovak prompts from the plan and a terminal QR code (`qrcode` 1.5.4). Tests pass stdin and stdout streams in.
- Tests: all cases from the plan, plus the window closing when the admin drops, malformed admin commands and the CLI paths.
- TDD: failed first, then passed.

### Task 9 - STT runner and sidecar (`8261daf`, robustness fix `9267a12`)

- `packages/stt-runner` from phase 1 was reused unchanged (plan note).
- `apps/stt`: HTTP contract (415, 400, 413, 503 single-flight, 502, 504, `/health` with a busy flag), `CliTranscriber` over `runTranscribeCli`, env config, and a model check at startup with no download.
- `provision`: streams the download to `.download` while hashing, renames only when the hash matches and deletes the file otherwise. The pinned revision, URL and SHA-256 are taken verbatim from the plan.
- Tests use the existing fake `transcribe-cli` script and a local HTTP server for provisioning.
- Dockerfile: compiler stage on `debian:trixie-slim` with the plan's packages and flags at commit `8facde6`. Runtime is `node:24-trixie-slim` with the Vulkan, Mesa and OpenBLAS runtime libraries, the `node` user and a healthcheck.
- `docker build -f apps/stt/Dockerfile -t codevo-whisper-stt:dev .` succeeded locally (arm64).
- TDD: failed first, then passed.

### Task 10 - Compose, dev client, setup guide (`e1de0d5`)

- Compose project `codevo-whisper`:
  - `gateway`: port `${CW_BIND:-127.0.0.1}:${CW_PORT:-8787}:8787`, volumes `cw-data` and `cw-run`, `ulimits.core: 0`.
  - `stt`: no ports, `/dev/dri`, `group_add` from `.env`, volume `cw-models`, `ulimits.core: 0`.
- `apps/server/Dockerfile`: CLI at `/usr/local/bin/codevo-whisper`. `/data` and `/run/codevo-whisper` are created with 0700 and owned by `node`.
- `tools/dev-client`: `pair` and `transcribe`, plus `FileIdentityStore` (0600, refuses to overwrite a pinned server key with `server_key_changed`) and a WAV reader.
- Tests: identity store (4, per plan) and WAV reader (3).
- `docs/operations/server-setup.md`: install, provision, pair, revoke, rotate, logs, WireGuard / Tailscale / Cloudflare Tunnel, dev client, "Overené".
- TDD: failed first, then passed.

## Security findings fixed after the automated review

1. `72a2652`: replaying a captured IK opening frame had side effects. Now the connection stays pre-auth (deadline running, no promote, no registry entry, no touch, no `ready`) until the first client transport message decrypts, and that message must be `hello`. Test: `has no side effects when a captured opening frame is replayed`.
2. `db7d693`: anyone who knew the server public key could burn the pairing window with an opening frame (IKpsk2 proves the psk only with the first transport message). Now the window is claimed only after `pair-request` decrypts, failures are counted per IP and per window, and a wrong secret no longer closes the window. Tests: `a wrong secret fails without closing the window`, `limits failed pairing attempts per IP`.
3. `db7d693`: a revoke (or rotate-key) racing a connecting session could leave it alive. After registration the device and the server key are checked again. Tests: `revoke racing ...`, `rotate-key racing ...`.
4. `db7d693`: the admin socket had default permissions until `chmod`. Now its directory must be owned by the gateway user with mode 0700 (startup fails otherwise) and the socket is created under umask 0177. Tests in `admin-server.test.ts`.
5. `9267a12`: a client that aborted mid-body could crash the STT sidecar through an unhandled rejection. Now `readPcm` returns `aborted`, request and response errors are handled and the single-flight slot is always released. The same `void promise` pattern was fixed in the gateway (connection, session start, dictation) and in the admin server. Tests: `survives a client that resets the socket mid-body`, `closes the connection instead of crashing when the device registry cannot be read`.

6. `38375d1` (gpt-6.1-sol): a channel kept processing messages while its socket was closing, so audio or `finish` after a revoke could still reach the STT. The channel now becomes terminal on `fail`/`close` and runs its close listeners (session dispose, registry removal) right away. Test: `ignores messages that arrive after the server closed the session`.
7. `38375d1` (gpt-6.1-sol): the pre-auth limits applied only after the WebSocket upgrade, so idle TCP connections or half-sent HTTP requests were not counted. Admission and the handshake deadline now apply per TCP connection, and HTTP header and request timeouts equal the deadline. Rejected WebSockets are terminated after a 2 s close grace period. Tests: `counts raw TCP connections before the upgrade and drops them at the deadline`, `limits concurrent connections per IP`.
8. `38375d1` (gpt-6.1-sol): a pairing that was waiting for the operator survived rotate-key, and a later approval could add a device under the old key. rotate-key now bumps a pairing generation before it rotates, so such an approval fails with `pairing_closed`. Test: `rotate-key cancels a pairing that waits for approval`.
9. `38375d1` (gpt-6.1-sol): fragmented WebSocket messages were reassembled and accepted. Now `maxFragments: 1`. Test: `rejects fragmented WebSocket messages`.

The same commit also fixes a flaky sidecar test: the sidecar now drains an unread request body after an early 413, 415 or 503 reply (bounded by a 60 s request timeout) instead of resetting the connection.

## Deviations from the plan

- **Branch instead of `main`**: commits go to `phase-2-protocol-server`, per the controller's instructions.
- **Task 1 commit message**: kept `chore: monorepo scaffold` even though only the protocol package was added.
- **Pairing secret is 32 bytes**: the spec said 128 bits, but Noise needs a 32-byte psk. A first version derived the psk as BLAKE2s(16-byte secret). By controller ruling the token now carries a 32-byte random secret that is the Noise psk directly, with no derivation (the controller updates the spec). Commit `fix(protocol): 32 byte pairing secret used directly as the psk`.
- **`hello` client message**: added because of finding 1. The session flow is `hello`, `ready`, `start`, and so on.
- **`partial` server message**: reserved in the codec (`{ segmentId, revision, text }`) at the controller's request for phase 3. Shapes were confirmed with the phase 3 agent, and an empty `final.text` is accepted.
- **`HandshakeState.remoteStaticKey()`**: added so the responder can check the device after the first message, before replying.
- **`PairingService.handle(channel, handshake, ip)`**: takes a `SecureChannel` (send, receive, close over WebSocket and `SecureTransport`) instead of a bare `SecureTransport`, because pairing has to exchange messages. `currentSecret(ip)` takes the IP for the failure limit.
- **`WindowPairingService.open(operator, ttlMs)`**: takes the admin-side `PairingOperator`, so the request goes to the admin connection that opened the window.
- **Extra admin events**: `abandoned` (the device left before a decision) and `failed` (too many failed attempts).
- **`TranscriptionQueue.enqueue(..., signal?)`**: an optional signal so `cancel` aborts only that dictation's jobs; `cancelDevice` stays for revoke. `size()` counts waiting jobs plus the running one.
- **Wire-level choices the plan left open**:
  - Pre-handshake rejections close with WebSocket code 4000 + error index and the code as the close reason.
  - Handshake timeout closes with 1008 and internal errors with 1011. Connections over the limit are dropped at TCP level.
- **Server image**: the gateway and the sidecar are bundled with esbuild (`scripts/bundle.js`, root dev dependency `esbuild` 0.28.2) instead of `pnpm deploy --prod`. There is no `node_modules` in the runtime images, and `dist/provision.js` exists as the plan's compose command expects.
- **STT build flags**: `-DBUILD_SHARED_LIBS=OFF` was added (accepted by the controller) and the image checks `ldd` at build time, so the single copied binary has no missing libraries. No aivora Dockerfile with transcribe.cpp flags was found to compare against.
- **`--language` for `auto`**: the phase 1 `stt-runner` leaves out `--language` for `auto`. Kept as is.
- **`beforeReady` hook**: `ServerOptions` and `GatewayDeps` take an optional `beforeReady(deviceId)` promise, awaited just before `ready`. Production never sets it. The test `refuses messages sent before ready` holds the gate, sends `start`, audio and `finish`, gets `bad_message` and the 4000 close, then releases the gate. It checks that no `ready` follows and that the STT saw no request. This replaced an earlier racy test (controller ruling).

## Home server smoke test

`codex@192.168.1.110` was unreachable for the first part of the session and came back later. The full plan steps then ran on it at commit `38375d1`, as compose project `codevo-whisper` in `~/Developer/codevo-whisper`. Other containers were not touched (11 kept running). Details are in `docs/operations/server-setup.md`, "Overené".

1. `.env`: `VIDEO_GID=44`, `RENDER_GID=990`, `CW_PUBLIC_ENDPOINT=ws://127.0.0.1:8787`.
2. Build OK. Provision downloaded and verified the model, and a second run reported it present. Both services `healthy`, the stt service on `vulkan`, `ss -ltn` showed only `127.0.0.1:8787`, core dumps disabled, data and socket files 0600 in 0700 directories.
3. Pairing over the SSH tunnel: both fingerprints matched between the server CLI and the dev client. I compared them and answered `y` myself. Device `e255ea96`.
4. The transcript matched the expected Slovak text exactly. The gateway reported 587 ms for 6.7 s of audio; client wall time was 0.9 s.
5. After `revoke`: `unknown_device`.

After the 32-byte secret change the stack was redeployed at `63162f0` and pair, transcribe and revoke were repeated with the same results. The stack is still running on the server with no paired devices. The revoked dev identity remains in `~/.config/codevo-whisper-dev/identity.json` on the Mac.

Before the server came back, the same flow was also checked locally with Docker Desktop (both image builds, container CLI, pairing, `stt_unavailable`, revoke).

## Reviews

- **Controller's automated review**: 5 findings, all fixed (items 1-5 above).
- **gpt-6.1-sol** (`codex exec -m gpt-6.1-sol -s read-only`, scope protocol, gateway, pairing, admin, spec section 4 as reference): no deviations in the Noise rev 34 logic (it replayed the vectors and 40,002 transport messages). 4 findings, all fixed (items 6-9).
- **CodeRabbit** (`coderabbit review --agent --base main`): the first runs hit the shared free-tier rate limit; the third run completed with 4 minor findings, all accepted and fixed in `7bdba68`:
  1. The report still had unfilled placeholders. Filled in.
  2. `STT_BACKEND=cpu` still needs `/dev/dri`. Documented that CPU-only hosts must remove `devices` and `group_add`; the plan's compose layout is kept.
  3. The dev client resolved relative WAV paths against the package directory. They are now resolved against `INIT_CWD`.
  4. When storing an approved device failed, the operator was never notified and the CLI hung. The device now gets `pairing_closed` and the operator `failed`. Test: `tells the operator when the approved device cannot be stored`.
- After the controller rulings, a second CodeRabbit run (branch up to `63162f0`) had 1 minor finding, accepted: the privacy line in `server-setup.md` now lists device ids among what is logged.
- No CodeRabbit findings were rejected.
