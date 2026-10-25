# Phase 1 - Protocol + Server Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paired device can open an end-to-end encrypted session to the gateway over any network, send PCM audio and receive the transcript from a self-hosted transcribe.cpp sidecar; the owner manages pairing and devices with a CLI.

**Architecture:** pnpm monorepo. `packages/protocol` implements Noise (`IKpsk2` for pairing, `IK` for sessions), framing, messages and the pairing token, shared by server and clients. `apps/server` is the gateway (WebSocket + admin unix socket + CLI). `packages/stt-runner` wraps the `transcribe-cli` binary and is used by `apps/stt` (HTTP sidecar) now and by the desktop LocalEngine later. `tools/dev-client` is a CLI client that proves the full path. Segmentation with partials is phase 2; phase 1 transcribes on `finish`, cutting audio into chunks of at most 25 s.

**Tech Stack:** Node 24 LTS, pnpm 10.34.5, TypeScript (strict, ESM), Vitest, ESLint flat config, `@noble/curves`, `@noble/ciphers`, `@noble/hashes`, `ws`, `qrcode`, Docker Compose, transcribe.cpp `8facde6fcd8fb9caa585a5788ab450df6e8ec7db`.

**Spec:** `docs/specs/2026-10-25-codevo-whisper-design.md` (sections 3, 4, 8, 9, 12 phase 1). Phase 0 findings in `docs/spikes/` take precedence where they changed the spec.

## Global Constraints

- Noise suite `25519_ChaChaPoly_BLAKE2s`, Noise spec revision 34. Pairing `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` with prologue `cw1/pair`; sessions `Noise_IK_25519_ChaChaPoly_BLAKE2s` with prologue `cw1/session` (UTF-8 bytes).
- Pairing token: `cw1:<server static public key>:<128-bit secret>:<endpoint>`; key and secret base64url without padding; endpoint `encodeURIComponent` of a `ws://` or `wss://` URL.
- No audio or side effects in handshake payloads. Audio accepted only after the server sent `ready`.
- Binary WebSocket messages only, `perMessageDeflate: false`, `maxPayload: 65536`. One WebSocket message = one Noise message, at most 65,535 bytes including the 16-byte tag.
- Never reset nonces. Rekey each direction every 10,000 messages. New handshake per connection.
- Gateway binds `127.0.0.1` by default (`CW_BIND`), port `8787` (`CW_PORT`).
- Server persists only its static key (`/data/server-key.json`, mode 0600) and the device registry (`/data/devices.json`). Never audio or text. Logs contain sizes, durations and error codes only.
- STT sidecar HTTP contract (same as aivora): `POST /transcribe?language=sk|en|cs|auto`, `Content-Type: application/octet-stream`, PCM16 LE mono 16 kHz, 640 to 960,000 bytes; `200 { "text": string }`, `400` invalid PCM, `413` too long, `415` wrong content type, `503` busy, `502`/`504` engine failure/timeout. `GET /health` -> `{ "status": "UP", "busy": boolean }`.
- Tests: real collaborators. The only fakes allowed are the STT HTTP service (fake server implementing the contract above) and the `transcribe-cli` binary (fake executable script).
- Verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Docker image builds only in Task 9 and Task 10 where the image is the deliverable.
- No code comments. Guard clauses, no `else`. Small focused files, interfaces for swappable parts (repositories, STT client, clock).
- Commits go to branch `phase-1-protocol-server`; push and PR only after the owner's OK.

## Review Focus

- Gateway restarts while a client is connected: the client gets a closed socket, reconnects with a fresh `IK` handshake and the same device key still works. Pinned in Task 7 Step 1 (`reconnects after gateway restart`).
- A second device starts dictating while the first is being transcribed: both get their text, the second waits instead of failing; a queue timeout produces `busy`, never a hang. Pinned in Task 6 Step 1 (`serves devices fairly and times out waiting jobs`).
- Messages in the wrong order (audio before `start`, audio after `finish`, two `start`s): the gateway answers `bad_message` and closes, without touching the STT. Pinned in Task 7 Step 1 (`rejects out-of-order messages`).
- The STT sidecar is down or returns 5xx: the client receives `error` with code `stt_unavailable` within the queue timeout. Pinned in Task 7 Step 1 (`reports stt_unavailable`).
- The gateway restarts during an open pairing window: the old token stops working (`pairing_closed`), a new `pair` works. Pinned in Task 8 Step 1 (`pairing token does not survive restart`).

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`, `.nvmrc`, `README.md`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/src/index.ts`, `packages/protocol/test/smoke.test.ts`

**Interfaces:**
- Produces: root scripts `pnpm lint`, `pnpm typecheck`, `pnpm test` running across workspaces; package name scope `@codevo-whisper/*`; workspace globs `apps/*`, `packages/*`, `tools/*`.

- [ ] **Step 1: Write the smoke test** `packages/protocol/test/smoke.test.ts`: `import { PROTOCOL_VERSION } from '../src/index.js'` and `expect(PROTOCOL_VERSION).toBe('cw1')`.
- [ ] **Step 2: Run** `pnpm install && pnpm test`. Expected: FAIL (`PROTOCOL_VERSION` not exported).
- [ ] **Step 3: Implement** root config: `"packageManager": "pnpm@10.34.5"`, `"engines": { "node": ">=24" }`, `"type": "module"`; TypeScript `strict`, `noUncheckedIndexedAccess`, `module`/`moduleResolution` `NodeNext`; ESLint flat config with `typescript-eslint` recommended-type-checked and `no-else-return`; `.gitignore` with `node_modules`, `dist`, `*.p8`, `*.p12`, `.env`. Export `PROTOCOL_VERSION = 'cw1'` from `packages/protocol/src/index.ts`. README: one paragraph from spec section 1 plus "work in progress".
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: all pass.
- [ ] **Step 5: Commit**

```bash
git checkout -b phase-1-protocol-server
git add -A
git commit -m "chore: monorepo scaffold"
```

---

### Task 2: Noise handshakes (IK, IKpsk2) with official vectors

**Files:**
- Create: `packages/protocol/src/noise/primitives.ts`, `cipher-state.ts`, `symmetric-state.ts`, `handshake-state.ts`, `patterns.ts`
- Create: `packages/protocol/test/vectors/noise-vectors.json`
- Test: `packages/protocol/test/noise-vectors.test.ts`, `packages/protocol/test/noise-handshake.test.ts`

**Interfaces:**
- Produces:
  - `type KeyPair = { publicKey: Uint8Array; privateKey: Uint8Array }`
  - `generateKeyPair(): KeyPair` (X25519), `publicKeyOf(privateKey: Uint8Array): Uint8Array`
  - `class CipherState { hasKey(): boolean; encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array; decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array; rekey(): void }`
  - `type HandshakePattern = 'IK' | 'IKpsk2'`
  - `createHandshake(options: { pattern: HandshakePattern; initiator: boolean; prologue: Uint8Array; staticKey: KeyPair; remoteStaticKey?: Uint8Array; psk?: Uint8Array; ephemeralKey?: KeyPair }): HandshakeState`
  - `interface HandshakeState { writeMessage(payload: Uint8Array): Uint8Array; readMessage(message: Uint8Array): Uint8Array; isComplete(): boolean; result(): HandshakeResult }`
  - `type HandshakeResult = { send: CipherState; receive: CipherState; handshakeHash: Uint8Array; remoteStaticKey: Uint8Array }`
  - `class NoiseError extends Error` (decryption failure, wrong state)

- [ ] **Step 1: Vendor the vectors.** From `https://github.com/haskell-cryptography/cacophony` (`vectors/cacophony.txt`, pin the commit hash in a `"source"` field), extract every vector whose `protocol_name` is `Noise_IK_25519_ChaChaPoly_BLAKE2s` or `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` into `noise-vectors.json`.
- [ ] **Step 2: Write the failing tests.** `noise-vectors.test.ts`: for each vector, build initiator and responder with the vector's prologue, static, ephemeral, remote static and psk values; replay the `messages` in order and assert each `ciphertext` equals the vector and each decrypted payload equals the vector `payload`, then assert `handshakeHash` equals `handshake_hash`. `noise-handshake.test.ts`: `rejects a tampered handshake message` (flip one byte -> `readMessage` throws `NoiseError`), `rejects a wrong psk` (IKpsk2 with different psk throws), `rejects a wrong prologue`, `exposes the initiator static key to the responder`.
- [ ] **Step 3: Run** `pnpm --filter @codevo-whisper/protocol test`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** per Noise spec rev 34 sections 5 and 9: BLAKE2s from `@noble/hashes/blake2s`, HMAC-based HKDF with BLAKE2s, ChaCha20-Poly1305 from `@noble/ciphers/chacha` with 96-bit nonce = 4 zero bytes + 64-bit little-endian counter, X25519 from `@noble/curves/ed25519`. `patterns.ts` holds the token lists for IK and IKpsk2. Counter is a `bigint`; `encryptWithAd` throws `NoiseError` at `2^64 - 1`. `rekey()` per spec section 4.2 (`REKEY(k)` = encrypt 32 zero bytes with nonce `2^64 - 1`).
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "feat(protocol): Noise IK and IKpsk2 handshakes"`

---

### Task 3: Secure transport, framing and messages

**Files:**
- Create: `packages/protocol/src/transport/secure-transport.ts`, `src/framing.ts`, `src/messages.ts`, `src/errors.ts`
- Test: `packages/protocol/test/secure-transport.test.ts`, `test/framing.test.ts`, `test/messages.test.ts`, `test/fuzz.test.ts`

**Interfaces:**
- Consumes: `HandshakeResult`, `CipherState` (Task 2).
- Produces:
  - `MAX_NOISE_MESSAGE = 65535`, `REKEY_EVERY = 10000`
  - `enum HandshakeMode { Pair = 0x01, Session = 0x02 }`, `PROLOGUE_PAIR`, `PROLOGUE_SESSION`
  - `encodeOpeningFrame(mode: HandshakeMode, noiseMessage: Uint8Array): Uint8Array`, `decodeOpeningFrame(frame: Uint8Array): { mode: HandshakeMode; noiseMessage: Uint8Array }`
  - `class SecureTransport { constructor(result: HandshakeResult, rekeyEvery?: number); seal(plaintext: Uint8Array): Uint8Array; open(ciphertext: Uint8Array): Uint8Array }`
  - `type Language = 'sk' | 'en' | 'cs' | 'auto'`
  - `type ClientMessage = { type: 'start'; sessionId: string; language: Language } | { type: 'audio'; pcm: Uint8Array } | { type: 'finish' } | { type: 'cancel' } | { type: 'pair-request'; deviceName: string }`
  - `type ServerMessage = { type: 'ready'; serverVersion: string } | { type: 'final'; segmentId: number; text: string } | { type: 'done' } | { type: 'flow'; paused: boolean } | { type: 'error'; code: ErrorCode; message: string } | { type: 'pair-result'; status: 'approved' | 'rejected'; deviceId?: string }`
  - `type ErrorCode = 'bad_message' | 'unknown_device' | 'busy' | 'stt_unavailable' | 'too_long' | 'session_expired' | 'revoked' | 'pairing_closed' | 'pairing_rejected' | 'server_key_changed'`
  - `encodeClientMessage`, `decodeClientMessage`, `encodeServerMessage`, `decodeServerMessage` (byte 0 = type tag; `audio` carries raw PCM after the tag, all others UTF-8 JSON after the tag); decoders throw `ProtocolError` with `code: 'bad_message'`
  - `class ProtocolError extends Error { code: ErrorCode }`

- [ ] **Step 1: Write the failing tests.** `secure-transport.test.ts`: `round-trips messages both ways`, `rejects replayed ciphertext` (opening the same ciphertext twice throws), `rejects reordered ciphertext`, `rekeys after REKEY_EVERY messages and keeps working` (use `rekeyEvery: 3`, send 10), `rejects plaintext larger than MAX_NOISE_MESSAGE - 16`. `framing.test.ts`: round trip, unknown mode byte throws `ProtocolError`, empty frame throws. `messages.test.ts`: round trip of every message type; `audio` with odd byte length rejected; JSON with unknown `type` rejected; `deviceName` longer than 64 characters rejected; `language` outside the four values rejected. `fuzz.test.ts` (dev dependency `fast-check`): 10,000 random byte arrays into `decodeOpeningFrame`, `decodeClientMessage` and `decodeServerMessage` never throw anything other than `ProtocolError`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** `SecureTransport` counts messages per direction and calls `rekey()` on the matching `CipherState` every `rekeyEvery` messages on both sides symmetrically. Validation in decoders by hand (no schema library), every field checked.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(protocol): secure transport, framing and messages"`

---

### Task 4: Pairing token and fingerprint

**Files:**
- Create: `packages/protocol/src/pairing.ts`
- Test: `packages/protocol/test/pairing.test.ts`

**Interfaces:**
- Produces:
  - `type PairingToken = { serverPublicKey: Uint8Array; secret: Uint8Array; endpoint: string }`
  - `createPairingSecret(): Uint8Array` (16 random bytes from `crypto.getRandomValues`)
  - `encodePairingToken(token: PairingToken): string`, `parsePairingToken(text: string): PairingToken` (throws `ProtocolError` `bad_message`)
  - `fingerprint(bytes: Uint8Array): string` - first 16 bytes of BLAKE2s(bytes) as uppercase hex in 8 groups of 4 separated by spaces, e.g. `7F3A 92C1 0B4E D8A6 51F0 3C9D 6E27 A4B8`

- [ ] **Step 1: Write the failing tests:** `round-trips a token`; `trims surrounding whitespace when parsing`; `rejects wrong prefix`, `wrong key length (not 32 bytes)`, `wrong secret length (not 16 bytes)`, `endpoint that is not ws:// or wss://`; `fingerprint has 8 groups of 4 hex chars`; `fingerprint is stable for the same input`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with `Buffer.from(..., 'base64url')` style helpers kept in this file.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(protocol): pairing token and fingerprint"`

---

### Task 5: Server configuration, key store and device registry

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/config.ts`, `src/keys/server-key-store.ts`, `src/devices/device-repository.ts`, `src/devices/file-device-repository.ts`
- Test: `apps/server/test/config.test.ts`, `test/server-key-store.test.ts`, `test/file-device-repository.test.ts`

**Interfaces:**
- Consumes: `generateKeyPair`, `KeyPair`, `fingerprint` (Tasks 2, 4).
- Produces:
  - `type ServerConfig = { bind: string; port: number; dataDir: string; adminSocket: string; sttUrl: string; publicEndpoint: string }` with `loadConfig(env: NodeJS.ProcessEnv): ServerConfig`; env names and defaults: `CW_BIND=127.0.0.1`, `CW_PORT=8787`, `CW_DATA_DIR=/data`, `CW_ADMIN_SOCKET=/run/codevo-whisper/admin.sock`, `CW_STT_URL=http://stt:8001`, `CW_PUBLIC_ENDPOINT=ws://127.0.0.1:8787` (the endpoint written into pairing tokens)
  - `class ServerKeyStore { constructor(dataDir: string); loadOrCreate(): Promise<KeyPair>; rotate(): Promise<KeyPair> }` - file `server-key.json`, created with mode `0o600`, refuses to load a file with group/other permission bits
  - `type Device = { id: string; name: string; publicKey: Uint8Array; pairedAt: string; lastSeenAt: string | null }`
  - `interface DeviceRepository { add(name: string, publicKey: Uint8Array): Promise<Device>; findByPublicKey(publicKey: Uint8Array): Promise<Device | null>; list(): Promise<Device[]>; remove(id: string): Promise<boolean>; removeAll(): Promise<void>; touch(id: string, at: Date): Promise<void> }`
  - `class FileDeviceRepository implements DeviceRepository` - file `devices.json`, mode `0o600`, atomic write (temp file + rename), device id = first 8 hex chars of BLAKE2s(publicKey)

- [ ] **Step 1: Write the failing tests** (real temp directories via `fs.mkdtemp`): `uses defaults`, `rejects a non-numeric port`; `creates a key with mode 0600`, `returns the same key on second load`, `refuses a world-readable key file`, `rotate replaces the key`; `adds and finds a device by public key`, `same key twice returns the existing device`, `remove returns false for unknown id`, `persists across instances`, `survives a crash between temp write and rename` (leave a stray temp file, new instance still loads the old content).
- [ ] **Step 2: Run** `pnpm --filter @codevo-whisper/server test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(server): config, key store and device registry"`

---

### Task 6: STT client and transcription queue

**Files:**
- Create: `apps/server/src/stt/stt-client.ts`, `src/stt/http-stt-client.ts`, `src/stt/transcription-queue.ts`, `src/stt/chunk-audio.ts`
- Create: `apps/server/test/support/fake-stt-server.ts`
- Test: `apps/server/test/http-stt-client.test.ts`, `test/transcription-queue.test.ts`, `test/chunk-audio.test.ts`

**Interfaces:**
- Consumes: `Language`, `ErrorCode` (Task 3).
- Produces:
  - `interface SttClient { transcribe(pcm: Uint8Array, language: Language, signal: AbortSignal): Promise<string> }`
  - `class HttpSttClient implements SttClient { constructor(baseUrl: string, timeoutMs = 120000) }` - maps `503` to `ProtocolError('busy')`, other non-2xx and network errors to `ProtocolError('stt_unavailable')`
  - `class TranscriptionQueue { constructor(client: SttClient, options: { waitTimeoutMs: number }); enqueue(deviceId: string, pcm: Uint8Array, language: Language): Promise<string>; cancelDevice(deviceId: string): void; size(): number }` - runs one job at a time, picks the next job round-robin across devices, rejects a job that waited longer than `waitTimeoutMs` (default 30000) with `ProtocolError('busy')`, `cancelDevice` aborts the running job of that device and rejects its waiting jobs
  - `chunkAudio(pcm: Uint8Array, maxSeconds = 25): Uint8Array[]` - splits PCM16 16 kHz into chunks of at most `maxSeconds`, never splitting a sample; drops a trailing chunk shorter than 640 bytes
  - `startFakeSttServer(behaviour: { respond?: (pcm: Uint8Array, language: string) => { status: number; body: unknown }; delayMs?: number }): Promise<{ url: string; requests: Array<{ language: string; bytes: number }>; close(): Promise<void> }>` - real HTTP server on a random port implementing the contract from Global Constraints

- [ ] **Step 1: Write the failing tests:** `http-stt-client`: `sends PCM with language and returns text`, `maps 503 to busy`, `maps 500 and connection refused to stt_unavailable`, `aborts on signal`. `transcription-queue`: `runs one job at a time` (fake STT with `delayMs`, assert max concurrency 1), `serves devices fairly and times out waiting jobs` (device A enqueues 3 jobs, device B 1 job; B finishes before A's third; with `waitTimeoutMs: 50` and a slow STT a waiting job rejects with `busy`), `cancelDevice rejects waiting jobs and aborts the running one`. `chunk-audio`: 60 s of PCM -> chunks of 25 s, 25 s, 10 s; odd input length rejected; 20 bytes -> no chunks.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(server): STT client and fair transcription queue"`

---

### Task 7: Gateway sessions over WebSocket

**Files:**
- Create: `apps/server/src/gateway/gateway.ts`, `src/gateway/pre-auth-limiter.ts`, `src/gateway/connection.ts`, `src/gateway/session-handler.ts`, `src/gateway/session-registry.ts`, `src/main.ts`
- Create: `apps/server/test/support/test-client.ts`, `test/support/recording-proxy.ts`
- Test: `apps/server/test/gateway-session.test.ts`, `test/pre-auth-limiter.test.ts`, `test/ciphertext.test.ts`

**Interfaces:**
- Consumes: Tasks 2-6.
- Produces:
  - `interface PairingService { currentSecret(): Uint8Array | null; handle(transport: SecureTransport, handshake: HandshakeResult): Promise<void> }` in `src/pairing/pairing-service.ts`; the gateway runs the `IKpsk2` responder only when `currentSecret()` is not null, otherwise it closes with `pairing_closed`. Task 7 uses `ClosedPairingService` (always `null`); Task 8 adds the real implementation
  - `startGateway(deps: { config: ServerConfig; serverKey: KeyPair; devices: DeviceRepository; queue: TranscriptionQueue; pairing: PairingService; clock?: () => number; handshakeTimeoutMs?: number }): Promise<{ port: number; close(): Promise<void>; sessions: SessionRegistry }>`
  - `class PreAuthLimiter { constructor(limits: { maxPendingTotal: 64; maxPendingPerIp: 4; maxConnectionsPerIp: 8 }); tryAcquire(ip: string): boolean; promote(ip: string): void; release(ip: string, authenticated: boolean): void }`
  - `class SessionRegistry { add(deviceId: string, close: (code: ErrorCode) => void): () => void; closeDevice(deviceId: string, code: ErrorCode): number; closeAll(code: ErrorCode): number; count(): number }`
  - Limits: handshake deadline 5000 ms, session maximum 600000 ms, audio maximum 600 s per session, flow `paused: true` when more than 300 s of unprocessed audio is buffered
  - Session flow: opening frame `Session` -> IK handshake (device key must be in the registry, else close with `unknown_device` without sending `ready`) -> `ready` -> `start` -> `audio`* -> `finish` -> `final` per chunk (segmentId from 0) -> `done`; `cancel` drops buffered audio and cancels queued jobs of this session
  - `test-client.ts`: `connectSession(url: string, device: KeyPair, serverPublicKey: Uint8Array): Promise<{ send(message: ClientMessage): void; next(): Promise<ServerMessage>; close(): void }>`
  - `recording-proxy.ts`: `startRecordingProxy(targetPort: number): Promise<{ port: number; bytes(): Uint8Array; close(): Promise<void> }>` (plain TCP proxy with `net`)

- [ ] **Step 1: Write the failing tests** (real gateway on port 0, real `FileDeviceRepository` in a temp dir, fake STT from Task 6):
  - `transcribes a session end to end` - paired device sends `start` (sk), 2 s of PCM, `finish`; receives `ready`, `final { segmentId: 0, text: 'ahoj svet' }`, `done`.
  - `splits long audio into 25 s chunks` - 60 s of PCM yields three `final` messages with segmentId 0, 1, 2 and the fake STT saw three requests.
  - `rejects an unknown device before ready` - socket closes, fake STT saw zero requests.
  - `rejects out-of-order messages` - `audio` before `start`, a second `start`, `audio` after `finish`: each closes with `bad_message`, fake STT saw zero requests.
  - `reports stt_unavailable` - fake STT returns 500; client receives `error { code: 'stt_unavailable' }`.
  - `cancel drops buffered audio` - `start`, audio, `cancel`: no request reaches the fake STT.
  - `reconnects after gateway restart` - close and restart the gateway with the same data dir; a new `connectSession` with the same device key gets `ready`.
  - `closes a session after the maximum duration` - inject `clock`, advance past 600000 ms, client receives `error { code: 'session_expired' }`.
  - `rejects a text frame and an oversized frame` - both close the socket.
  - `signals flow pause when buffered audio exceeds 300 s` - after 301 s of audio without `finish` the client receives `flow { paused: true }`.
  - `closes a connection that does not finish the handshake in time` - `handshakeTimeoutMs: 100`, client sends only the opening frame, socket closes and the limiter slot is released.
  - `pre-auth-limiter`: per-IP pending limit, global pending limit, `promote` frees the pending slot, `release` frees slots.
  - `ciphertext.test.ts`: client -> recording proxy -> gateway; send 5 s of PCM with a distinctive byte pattern and have the fake STT return `tajny-prepis-12345`; assert no 64-byte window of the PCM and no UTF-8 bytes of `tajny-prepis-12345` appear in `proxy.bytes()`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `ws` server with `perMessageDeflate: false`, `maxPayload: 65536`; text frames close with code 1003. Each connection: acquire limiter slot, start handshake deadline timer, decode opening frame, dispatch on mode, run handshake, then hand a `SecureTransport` to `SessionHandler`. On `ready` call `devices.touch(deviceId, now)`. `src/main.ts` wires config, key store, repository, `HttpSttClient`, queue, gateway and logs one line per session (`deviceId`, audio seconds, chunk count, duration ms, result code).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(server): encrypted gateway sessions"`

---

### Task 8: Pairing, admin socket and CLI

**Files:**
- Create: `apps/server/src/pairing/pairing-service.ts`, `src/admin/admin-server.ts`, `src/admin/admin-protocol.ts`, `src/cli/main.ts`, `src/cli/commands.ts`
- Test: `apps/server/test/pairing.test.ts`, `test/admin-cli.test.ts`

**Interfaces:**
- Consumes: Tasks 2-7.
- Produces:
  - `class WindowPairingService implements PairingService { open(ttlMs = 600000): { token: string; expiresAt: number }; isOpen(): boolean; close(): void; currentSecret(): Uint8Array | null; handle(transport: SecureTransport, handshake: HandshakeResult): Promise<void> }` - single device per window; the psk is the window secret; on `pair-request` it emits a request to the admin connection that opened the window and waits for `approve` / `reject`; the window closes atomically on the first completed handshake, on expiry, or when the admin connection drops
  - Admin protocol (JSON lines over the unix socket `CW_ADMIN_SOCKET`, mode 0600):
    - `{"cmd":"pair","ttlMs":600000}` -> `{"event":"token","token":"cw1:...","expiresAt":...}`, then `{"event":"request","deviceName":"...","deviceFingerprint":"....","handshakeFingerprint":"...."}`; client answers `{"decision":"approve"}` or `{"decision":"reject"}` -> `{"event":"paired","deviceId":"..."}` | `{"event":"rejected"}` | `{"event":"expired"}`
    - `{"cmd":"devices"}` -> `{"devices":[{"id","name","pairedAt","lastSeenAt","fingerprint"}]}`
    - `{"cmd":"revoke","deviceId":"..."}` -> `{"revoked":true,"closedSessions":n}`; removes the device, closes its sessions with `revoked`, calls `queue.cancelDevice`
    - `{"cmd":"rotate-key"}` -> `{"rotated":true,"fingerprint":"...."}`; rotates the server key, removes all devices, closes all sessions with `server_key_changed`
    - `{"cmd":"status"}` -> `{"version","devices","activeSessions","queue","stt":"UP"|"DOWN"|"BUSY"}`
  - CLI `codevo-whisper <pair|devices|revoke <id>|rotate-key|status>`: `pair` prints the token and a terminal QR (`qrcode` `toString(token, { type: 'terminal', small: true })`), then on request prints device name and both fingerprints and asks `Spárovať toto zariadenie? [y/N]`; `rotate-key` asks for confirmation `Všetky zariadenia sa budú musieť znova spárovať. Pokračovať? [y/N]`
  - Test client addition: `pairDevice(url: string, token: PairingToken, device: KeyPair, deviceName: string): Promise<{ status: 'approved' | 'rejected'; deviceId?: string; handshakeFingerprint: string }>`

- [ ] **Step 1: Write the failing tests** (real gateway, real admin socket in a temp dir, CLI functions called with injected stdin/stdout streams):
  - `pairs a device after approval` - `pair` -> token -> `pairDevice` -> admin sees `request` with matching fingerprints -> `approve` -> device can `connectSession` and gets `ready`.
  - `rejected device cannot connect` - `reject` -> `connectSession` closes with `unknown_device`.
  - `token works only once` - second `pairDevice` with the same token fails with `pairing_closed`.
  - `wrong secret fails and closes the window`.
  - `expired window rejects pairing` (inject clock).
  - `pairing token does not survive restart` - restart gateway with same data dir, old token fails with `pairing_closed`, a new `pair` works.
  - `no pairing without an open window`.
  - `revoke closes the active session and cancels its jobs` - active session with a slow fake STT receives `error { code: 'revoked' }`, fake STT request aborted, reconnect fails with `unknown_device`.
  - `rotate-key forces re-pairing` - old device gets `server_key_changed`, cannot connect, new pairing works.
  - `admin socket has mode 0600`.
  - `status reports devices, sessions and STT state`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Wire `WindowPairingService` into `src/main.ts` instead of `ClosedPairingService`. Pairing handshake: responder `IKpsk2` with `psk = window secret`, prologue `PROLOGUE_PAIR`; payload-free handshake; then `pair-request` over `SecureTransport`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(server): pairing, admin socket and CLI"`

---

### Task 9: STT runner and sidecar

**Files:**
- Create: `packages/stt-runner/package.json`, `src/index.ts`, `src/wav.ts`, `src/run-transcribe-cli.ts`
- Create: `apps/stt/package.json`, `apps/stt/src/server.ts`, `apps/stt/src/provision.ts`, `apps/stt/src/main.ts`, `apps/stt/Dockerfile`
- Create: `packages/stt-runner/test/support/fake-transcribe-cli.sh`
- Test: `packages/stt-runner/test/run-transcribe-cli.test.ts`, `test/wav.test.ts`, `apps/stt/test/server.test.ts`, `apps/stt/test/provision.test.ts`

**Interfaces:**
- Produces:
  - `pcmToWav(pcm: Uint8Array, sampleRate = 16000): Uint8Array` (RIFF/WAVE, PCM16 mono)
  - `runTranscribeCli(options: { binary: string; model: string; backend: 'vulkan' | 'metal' | 'cpu'; threads: number; language: Language; pcm: Uint8Array; timeoutMs?: number; signal?: AbortSignal }): Promise<string>` - writes the WAV to a private temp dir, runs `<binary> --model <model> --backend <backend> --language <language> --threads <threads> --timestamps none --quiet --output <out> <wav>`, reads at most 16000 bytes of output (more -> error), trims, removes the temp dir in all cases, kills the process on timeout (default 120000) or abort
  - `apps/stt` server implementing the HTTP contract from Global Constraints, single-flight (second concurrent request -> 503), env `STT_BINARY=/opt/transcribe/bin/transcribe-cli`, `STT_MODEL_PATH=/models/parakeet-ultra-F16.gguf`, `STT_BACKEND=vulkan`, `STT_THREADS=4`, `STT_PORT=8001`
  - `provision(options: { url: string; sha256: string; target: string; fetchImpl?: typeof fetch }): Promise<'present' | 'downloaded'>` with pinned defaults: revision `a1539be1b849ea7463b88343e5277b373d0c4ea9`, URL `https://huggingface.co/handy-computer/parakeet-ultra-gguf/resolve/a1539be1b849ea7463b88343e5277b373d0c4ea9/parakeet-ultra-F16.gguf`, SHA-256 `cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d`; streams to `<target>.download`, hashes while streaming, renames only on match, deletes on mismatch

- [ ] **Step 1: Write the failing tests:** `wav`: header fields (sample rate 16000, 1 channel, 16 bits, data size). `run-transcribe-cli` with the fake script (echoes its arguments into the output file, or sleeps, or writes 20000 bytes, depending on an env var): `passes the expected arguments`, `returns trimmed text`, `rejects oversized output`, `kills the process on timeout`, `removes the temp dir after success and after failure`. `server`: contract cases from Global Constraints (`415`, `400` for 639 bytes and odd length, `413` above 960000, `503` on concurrent request, `200` with text, `/health` busy flag). `provision`: local HTTP server serving a file; `downloads and verifies`, `returns present when hash matches`, `deletes on mismatch and throws`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Dockerfile: compiler stage identical to the aivora build (`debian:trixie-slim`, packages `ca-certificates git cmake ninja-build g++ libvulkan-dev glslc spirv-headers libopenblas-dev`, fetch commit `8facde6fcd8fb9caa585a5788ab450df6e8ec7db`, `cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DTRANSCRIBE_VULKAN=ON -DTRANSCRIBE_BUILD_TESTS=OFF -DGGML_NATIVE=OFF`, target `transcribe-cli`); runtime stage `node:24-trixie-slim` with `libvulkan1 mesa-vulkan-drivers libopenblas0 libgomp1`, non-root user, `ulimit -c 0` equivalent via compose (`ulimits: core: 0`), no access logs.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS. Then build the image once: `docker build -f apps/stt/Dockerfile -t codevo-whisper-stt:dev .` Expected: success.
- [ ] **Step 5: Commit** `git commit -m "feat(stt): transcribe.cpp runner and HTTP sidecar"`

---

### Task 10: Compose, dev client and home-server smoke test

**Files:**
- Create: `apps/server/Dockerfile`, `infrastructure/compose/compose.yaml`, `infrastructure/compose/.env.example`
- Create: `tools/dev-client/package.json`, `tools/dev-client/src/main.ts`, `src/identity-store.ts`
- Create: `docs/operations/server-setup.md`
- Test: `tools/dev-client/test/identity-store.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `compose.yaml`: project name `codevo-whisper`; service `gateway` (ports `${CW_BIND:-127.0.0.1}:${CW_PORT:-8787}:8787`, volumes `cw-data:/data` and `cw-run:/run/codevo-whisper`, env from `.env`, `ulimits.core: 0`); service `stt` (no ports, `devices: [/dev/dri]`, `group_add` for the host `video` and `render` GIDs via `.env`, volume `cw-models:/models`, `ulimits.core: 0`); provisioning via `docker compose run --rm stt node dist/provision.js`
  - CLI inside the gateway image at `/usr/local/bin/codevo-whisper`
  - `dev-client` commands: `pair "<token>" --name <deviceName>` and `transcribe <file.wav> [--language sk]`; identity in `~/.config/codevo-whisper-dev/identity.json` (mode 0600: device key pair, pinned server public key, endpoint)
  - `IdentityStore { load(): Promise<Identity | null>; save(identity: Identity): Promise<void> }`

- [ ] **Step 1: Write the failing test:** `identity-store`: `saves with mode 0600`, `round-trips keys`, `returns null when missing`, `refuses to overwrite a pinned server key with a different one` (throws `ProtocolError('server_key_changed')`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the dev client, `apps/server/Dockerfile` (`node:24-trixie-slim`, `pnpm deploy --prod`, non-root user), `compose.yaml`, `.env.example`, and `docs/operations/server-setup.md` (install, provision, pair, revoke, rotate, logs, exposing over WireGuard or Cloudflare Tunnel with `CW_PUBLIC_ENDPOINT`).
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5: Home-server smoke test** (owner present; aivora untouched):
  1. Copy the repo to `codex@192.168.1.110:~/Developer/codevo-whisper`, `cp infrastructure/compose/.env.example infrastructure/compose/.env`, set `CW_PUBLIC_ENDPOINT=ws://127.0.0.1:8787` and the `video`/`render` GIDs.
  2. `docker compose -f infrastructure/compose/compose.yaml build && docker compose ... run --rm stt node dist/provision.js && docker compose ... up -d`. Expected: `docker compose ps` shows both healthy; `ss -ltn` shows `127.0.0.1:8787` only.
  3. On the Mac: `ssh -N -L 8787:127.0.0.1:8787 codex@192.168.1.110`. On the server: `docker compose ... exec gateway codevo-whisper pair`. On the Mac: `pnpm --filter dev-client start pair "<token>" --name "MacBook dev"`, compare fingerprints, approve.
  4. `curl -s 127.0.0.1:8015/sample.wav` on the server, copy to the Mac, `pnpm --filter dev-client start transcribe sample.wav --language sk`. Expected: `Ahoj, toto je skúška prepisu slovenskej reči na grafickej karte. Potrebujem skontrolovať náš editor a potom odoslať zmenu.`
  5. `codevo-whisper revoke <id>`; repeat step 4. Expected: `unknown_device`.
  Record results in `docs/operations/server-setup.md` under "Overené".
- [ ] **Step 6: Commit** `git commit -m "feat: compose deployment, dev client and server setup guide"`

---

### Task 11: Phase review

- [ ] **Step 1:** `coderabbit review --agent --base main`; fix valid findings, note rejected ones for the PR.
- [ ] **Step 2:** Security review of `packages/protocol` and `apps/server/src/gateway` + `src/pairing` by gpt-6.1-sol (`codex exec -m gpt-6.1-sol -s read-only`), with the spec section 4 as the reference. Fix valid findings.
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 4:** Owner OK, then push the branch and open the PR.
