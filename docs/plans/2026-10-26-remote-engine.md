# Stream E - RemoteEngine and pairing in the desktop app - Implementation Plan

> **For agentic workers:** executed natively by the stream E agent (stream rules forbid subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the macOS app transcribes on the owner's paired server over Noise IK, pairs by pasting a `cw1:` token, and lets the user choose the engine order in "Kde beží prepis".

**Architecture:** `TranscriptionEngine` grows from a batch `transcribe(pcm)` into a streaming Strategy (`prepare()` before recording, then `push / finish` and an `AbortSignal` for cancel). `LocalEngine` keeps its batch logic behind a buffering adapter. `RemoteEngine` streams capture frames to the gateway over a `SecureConnection` (ws + `packages/protocol`), keeps a bounded 2 minute retry buffer and retries the whole session once on a new handshake. Pairing data lives in an encrypted file (Electron `safeStorage` behind a `SecretVault` adapter). A `ServerService` facade feeds the Server page and the IPC.

**Tech Stack:** Electron 45 main process (Node), `ws` 8.22.0, `@codevo-whisper/protocol` (workspace), React 19 renderer, Vitest 5, Playwright 1.64.

**Spec:** `docs/specs/2026-10-25-codevo-whisper-design.md` sections 4.2, 4.3, 4.4, 4.6, 5.4, 12 (phase 2). Server side: `docs/operations/server-setup.md`, `docs/reports/phase-2-report.md`.

## Global Constraints

- No code comments, guard clauses only (ESLint forbids `else`), small focused files, interfaces for swappable parts.
- Tests use real collaborators: the real `packages/protocol`, the real gateway from `apps/server` (`startServer`) with the fake STT HTTP server (`apps/server/test/support/fake-stt-server.ts`). Only OS boundaries are faked (Keychain via a test `SecretVault`, `FakeInputHelper`, in-process capture).
- Keys never cross into a renderer. The renderer sees fingerprints, host, device id and status only.
- A changed server key is never accepted automatically; it is a hard error that requires re-pairing (spec 4.2).
- Engine selection happens before recording starts, never mid-session (spec 5.4). Local -> server only with the explicit order "Lokálne, potom server".
- Client buffer for the reconnect retry: at most 120 s of PCM16 16 kHz mono (3,840,000 bytes); one whole-session retry with a new handshake and a new `sessionId` (spec 5.4).
- Outgoing audio frames: at least 640 bytes except the last one, at most 32,000 bytes, so a backlog stays under the gateway's 1000-message burst.
- Partials are optional: no `partials` field is sent yet (stream F adds `start.partials?: boolean`); `partial` messages are accepted and ignored. Indikátor mode must work without them.
- Shared files touched by stream H (`compose.ts`, `ipc-contract.ts`, `settings.ts`, Settings page, preload): additive edits only.
- Slovak UI copy with diacritics.

## Review Focus

1. The server drops mid-dictation (Wi-Fi switch, gateway restart): the dictation is retried once on a new connection and the text is not duplicated. Pinned by the proxy tests in Task 7.
2. The server key was rotated: the app must not connect, must say "Kľúč servera sa zmenil" and require re-pairing. Pinned in Task 4 (connector) and Task 9 (Server page e2e uses the status).
3. The device was revoked on the server: the dictation fails with a re-pair message, not a generic error. Pinned in Task 4 and Task 6.
4. A dictation longer than 2 minutes loses the connection: no retry, the text so far stays as the last transcript. Pinned in Task 7.
5. "Server, potom lokálne" with the server offline: the local engine is used, no audio is ever sent. Pinned in Task 2 (selector) and Task 8 (coordinator).

---

### Task 1: Engine order settings

**Files:** Modify `apps/desktop/src/shared/settings.ts`, `apps/desktop/src/main/settings/settings-fields.ts`, `apps/desktop/test/settings-store.test.ts` (or `ipc-validate.test.ts`), `apps/desktop/e2e/settings.spec.ts` (the invalid patch example).

**Interfaces:** Produces `ENGINE_ORDERS: ReadonlyArray<ReadonlyArray<EngineId>>` = `[['local'], ['server'], ['server', 'local'], ['local', 'server']]` and `isEngineOrder(value): value is EngineId[]` in `shared/settings.ts`.

- [ ] Failing tests: each of the four orders is accepted by `validateSettingsPatch`; `[]`, `['server','server']`, `['local','local']`, `['cloud']` and `['local','server','local']` are rejected; a stored `['server','local']` survives `sanitizeSettings`.
- [ ] Replace `isPhaseOneEngineOrder` with `isEngineOrder`. The e2e invalid-patch example becomes `{"engineOrder":["server","server"]}`.
- [ ] Commit `feat(desktop): allow the four engine orders`.

### Task 2: Streaming engine interface, frames from the capture, engine selection

**Files:**
- Modify `src/main/engines/transcription-engine.ts`, `src/main/engines/local-engine.ts`, `src/main/audio/audio-capture.ts`, `src/main/audio/window-audio-capture.ts`, `src/main/session/dictation-session.ts`, `src/main/session/session-coordinator.ts`, `src/main/session/overlay-messages.ts`, `src/main/app/compose.ts`, `test/in-process-capture.ts`.
- Create `src/main/engines/buffered-dictation.ts`, `src/main/engines/engine-selector.ts`, `src/main/session/frame-relay.ts`.
- Test: `test/engine-selector.test.ts`, `test/window-audio-capture.test.ts` (frame event), existing `test/session-coordinator.test.ts` stays green.

**Interfaces (produces):**
```ts
type DictationOptions = { language: Language; signal: AbortSignal };
interface EngineDictation { push(pcm: Uint8Array): void; finish(): Promise<string> }
type PreparedEngine = { readonly id: EngineId; start(options: DictationOptions): EngineDictation; release(): void };
type Preparation = { ready: true; engine: PreparedEngine } | { ready: false; reason?: EngineUnavailableReason };
interface TranscriptionEngine { readonly id: EngineId; prepare(): Promise<Preparation> }
class TranscriptionFailedError extends Error { reason: EngineFailureReason; textSoFar: string }
class EngineSelector { constructor(engines: TranscriptionEngine[]); prepare(order: readonly EngineId[]): Promise<Preparation> }
AudioCapture.onFrame(listener: (pcm: Uint8Array) => void): () => void
```
`EngineUnavailableReason` gains `'server-not-paired' | 'server-offline' | 'server-repair-needed' | 'server-busy' | 'server-storage'`; `EngineFailureReason = 'busy' | 'stt-unavailable' | 'too-long' | 'connection-lost' | 'repair-needed' | 'protocol'`.

- [ ] Failing tests: selector returns the first ready engine in order; returns the primary engine's reason when none is ready; never calls `prepare` on engines after the first ready one; window capture emits each kept recording frame (and not meter frames) through `onFrame`.
- [ ] `LocalEngine.prepare()` = `isReady()` + a `BufferedDictation` that concatenates pushed PCM and calls `transcribe(pcm, language, signal)` on `finish()`.
- [ ] `DictationSession.begin()` calls `selector.prepare(settings.engineOrder)`; frames from `capture.onFrame` go through a `FrameRelay` that buffers until the prepared engine has started, then forwards. Abandon or cancel calls `release()`. `finish` awaits the capture stop, then `dictation.finish()` inside the pipeline. A `TranscriptionFailedError` with non-empty `textSoFar` sets the last transcript and shows the failure message with the `copy-last` action (overlay `error.action` gains `'copy-last'`).
- [ ] Coordinator deps: `engines: EngineSelector` instead of `engine`.
- [ ] Commit `refactor(desktop): streaming engine interface with selection before recording`.

### Task 3: Secure connection client

**Files:** Create `src/main/remote/secure-connection.ts`, `src/main/remote/remote-failure.ts`. Add `ws`, `@types/ws`, `@codevo-whisper/protocol` to `apps/desktop/package.json` (dev dependencies, bundled into main). Test: `test/secure-connection.test.ts` with a scripted Noise responder over a real `ws` server.

**Interfaces (produces):**
```ts
type RemoteFailureKind = 'not-paired' | 'offline' | 'device-unknown' | 'server-key-changed' | 'busy' | 'stt-unavailable' | 'too-long' | 'connection-lost' | 'protocol' | 'storage-insecure' | 'pairing-closed' | 'pairing-rejected' | 'timeout';
class RemoteFailure extends Error { kind: RemoteFailureKind }
failureForCode(code: ErrorCode): RemoteFailureKind
type ConnectionOptions = { handshakeTimeoutMs: number; keepAliveMs?: number; rekeyEvery?: number };
class SecureConnection {
  static open(endpoint: string, handshake: ClientHandshake, options: ConnectionOptions): Promise<SecureConnection>;
  readonly handshakeHash: Uint8Array;
  send(message: ClientMessage): void;
  onMessage(listener: (message: ServerMessage) => void): void;
  onClose(listener: (failure: RemoteFailure) => void): void;
  next(timeoutMs: number): Promise<ServerMessage>;
  close(): void;
}
```
- [ ] Failing tests: handshake timeout -> `timeout` and the socket is terminated; an unauthenticated handshake reply -> `server-key-changed`; a close with `closeCodeFor('unknown_device')` before the reply -> `device-unknown`, with `bad_message` before the reply -> `server-key-changed`; a text frame or an undecodable message closes with `protocol`; messages round-trip with `rekeyEvery: 3` on both sides over 10 messages; a peer that stops answering pings is detected within `2 x keepAliveMs` (`connection-lost`).
- [ ] `ws` with `perMessageDeflate: false`, `maxPayload: 65_536`. Close codes via `errorCodeForClose`; network errors and closes without a code -> `offline` before the handshake, `connection-lost` after.
- [ ] Commit `feat(desktop): secure connection client over the cw1 protocol`.

### Task 4: Pairing storage and server connector

**Files:** Create `src/main/remote/secret-vault.ts` (interface + `ElectronSafeStorageVault`), `src/main/remote/pairing-repository.ts` (interface + `EncryptedPairingFile`), `src/main/remote/server-connector.ts`. Test: `test/pairing-repository.test.ts`, `test/server-connector.test.ts`, `test/support/test-vault.ts`, `test/support/gateway.ts` (real gateway + fake STT + admin helpers on a free port).

**Interfaces (produces):**
```ts
type VaultAvailability = 'available' | 'insecure' | 'unavailable';
interface SecretVault { availability(): VaultAvailability; seal(text: string): Uint8Array; open(sealed: Uint8Array): string }
type ServerPairing = { deviceKey: KeyPair; serverPublicKey: Uint8Array; endpoint: string; deviceId: string; deviceName: string; pairedAt: string };
interface PairingRepository { load(): Promise<ServerPairing | null>; save(pairing: ServerPairing): Promise<void>; clear(): Promise<void> }
type ReadyConnection = { connection: SecureConnection; serverVersion: string; connectMs: number };
interface ConnectionObserver { connected(connectMs: number, serverVersion: string): void; failed(kind: RemoteFailureKind): void }
class ServerConnector { constructor(deps: { pairings: PairingRepository; observer: ConnectionObserver; clock: () => number; timeoutMs: number }); connect(): Promise<ReadyConnection> }
```
- [ ] Failing tests: the file is mode 0600 and contains no key material in clear text; load after save returns the same keys; `clear` removes it; a corrupt file loads as `null`; save refuses with `storage-insecure` when the vault is `insecure` (Linux `basic_text`) or `unavailable`. Connector: a paired device gets `ready` and a `connectMs`; after `revoke` -> `device-unknown`; after `rotate-key` -> `server-key-changed`; a closed port -> `offline`; a silent TCP listener -> `timeout`; no pairing -> `not-paired`; the observer sees each outcome.
- [ ] `ElectronSafeStorageVault`: `unavailable` without `isEncryptionAvailable()`, `insecure` on Linux when `getSelectedStorageBackend()` is `basic_text` or `unknown`. File `server-pairing.json` = `{ version: 1, sealed: <base64> }` written with `writeFileAtomic` (0600).
- [ ] Commit `feat(desktop): encrypted server pairing and session connector`.

### Task 5: Device pairing over IKpsk2

**Files:** Create `src/main/remote/device-pairing.ts`, `src/main/remote/computer-name.ts`. Test: `test/device-pairing.test.ts` against the real gateway and its admin socket.

**Interfaces (produces):**
```ts
type PairingStep = { kind: 'connecting' } | { kind: 'awaiting-approval'; connectionFingerprint: string; deviceFingerprint: string; deviceName: string };
type PairingOutcome = { kind: 'paired'; pairing: ServerPairing } | { kind: 'failed'; failure: PairingFailure };
type PairingFailure = 'invalid-token' | 'unreachable' | 'pairing-closed' | 'rejected' | 'storage-insecure' | 'cancelled' | 'failed';
class DevicePairing { constructor(deps: { pairings: PairingRepository; vault: SecretVault; deviceName: () => Promise<string>; clock: () => number }); pair(token: string, onStep: (step: PairingStep) => void, signal: AbortSignal): Promise<PairingOutcome> }
computerName(): Promise<string>  // scutil --get ComputerName on darwin, hostname otherwise; control characters removed, at most 64 characters
```
- [ ] Failing tests: approve -> `paired`, the saved pairing works with `ServerConnector`, and the UI fingerprint equals the operator's `handshakeFingerprint`; the operator sees `deviceName`; reject -> `rejected` and nothing saved; no open window -> `pairing-closed`; garbage token -> `invalid-token`; abort while waiting -> `cancelled` and the operator gets `abandoned`; insecure vault -> `storage-insecure` before any network call. Approval may take up to the 10 minute window, so there is no client deadline after the fingerprint is shown.
- [ ] Commit `feat(desktop): pair with a server by pasting the cw1 token`.

### Task 6: RemoteEngine dictation

**Files:** Create `src/main/remote/remote-engine.ts`, `src/main/remote/remote-dictation.ts`, `src/main/remote/audio-outbox.ts`. Test: `test/remote-engine.test.ts` (real gateway, fake STT), `test/audio-outbox.test.ts`.

**Interfaces:** consumes `ServerConnector`, `TranscriptionEngine`; produces `class RemoteEngine implements TranscriptionEngine` with `id = 'server'`; `RemoteEngineOptions = { finishIdleMs: number; retryBufferBytes: number }` (defaults 30,000 ms and 3,840,000 bytes).

- [ ] Failing tests: frames pushed during recording are streamed and the joined finals in segment order come back (26 s of audio, the fake STT answers by chunk size, so segments 0 and 1 have distinct texts); empty finals are skipped in the join; `prepare` without pairing -> `server-not-paired`, with the server down -> `server-offline`, after revoke -> `server-repair-needed`; STT 503 -> `TranscriptionFailedError('busy')`, STT 500 -> `stt-unavailable`, more than 600 s -> `too-long`; abort during finishing sends `cancel`, `finish` rejects and the gateway logs `cancelled`; no server message for `finishIdleMs` after `finish` -> `connection-lost`. Outbox: frames below 640 bytes are held until more audio or `finish`, a backlog is coalesced into frames of at most 32,000 bytes.
- [ ] Messages with another `sessionId` and `partial` messages are ignored; `flow { paused: true }` holds frames until `paused: false` or `finish`.
- [ ] Commit `feat(desktop): RemoteEngine streams dictations to the paired server`.

### Task 7: Reconnect retry with the bounded buffer

**Files:** Modify `src/main/remote/remote-dictation.ts`; create `src/main/remote/retry-buffer.ts`. Test: `test/remote-retry.test.ts` with a TCP proxy that can drop all connections (the pairing endpoint points at the proxy).

- [ ] Failing tests: the proxy drops the connection mid-recording -> one reconnect with a new handshake and `sessionId`, the full audio is re-sent and the final text appears once; a drop after `finish` is retried the same way; a second drop -> `connection-lost` with the best `textSoFar`; a dictation over 120 s that drops -> no retry, `connection-lost`; `device-unknown` and `busy` are never retried.
- [ ] Commit `feat(desktop): retry a dropped server dictation once from the 2 minute buffer`.

### Task 8: ServerService, status, IPC and composition

**Files:** Create `src/shared/server.ts`, `src/main/remote/server-status.ts`, `src/main/remote/server-service.ts`, `src/main/ipc/server-handlers.ts`, `src/main/app/server-wiring.ts`, `test/support/...` as needed. Modify (additively) `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc/register-ipc.ts`, `src/main/ipc/validate.ts`, `src/main/app/compose.ts`, `src/main/status/app-status-service.ts`. Test: `test/server-service.test.ts`, `test/ipc-validate.test.ts`, `test/app-status.test.ts`, `test/session-coordinator.test.ts` (remote and fallback cases).

**Interfaces (produces):**
```ts
type ServerStatus = { kind: 'unknown' } | { kind: 'checking' } | { kind: 'online'; connectMs: number; serverVersion: string } | { kind: 'offline' } | { kind: 'repair-needed'; reason: 'server-key-changed' | 'device-unknown' };
type PairedServerView = { host: string; endpoint: string; deviceId: string; deviceName: string; pairedAt: string; serverFingerprint: string; status: ServerStatus };
type PairingView = { kind: 'idle' } | PairingStep | { kind: 'paired'; deviceId: string } | { kind: 'failed'; failure: PairingFailure };
type ServerView = { storage: VaultAvailability; server: PairedServerView | null; pairing: PairingView };
IPC: getServer(): ServerView; pairServer(token: string): void; cancelServerPairing(): void; checkServer(): void; disconnectServer(): { revokeCommand: string }; event 'server-changed': ServerView
```
- [ ] Failing tests: the view goes `idle -> connecting -> awaiting-approval -> paired`, then `status` becomes `online`; `checkServer` against a stopped gateway -> `offline`; `disconnectServer` deletes only the local file, returns `docker compose -f infrastructure/compose/compose.yaml exec gateway codevo-whisper revoke <deviceId>` and switches an engine order containing `server` back to `['local']`; tokens longer than 1024 characters or not strings are rejected by IPC validation; `AppStatus.modelReady` is true when the order's first engine is `server` and a pairing exists; coordinator: `['server']` inserts the server text, `['server','local']` with the server down uses the local engine and the gateway never sees audio.
- [ ] Commit `feat(desktop): server service, status and IPC for pairing`.

### Task 9: Server page and "Kde beží prepis"

**Files:** Rewrite `src/renderer/pages/Server.tsx`; create `src/renderer/server/*` (hooks and small components); modify `src/renderer/settings/EngineSection.tsx`, `src/renderer/pages/Settings.tsx` (pass settings), styles in `src/renderer/styles/pages.css`. Test: `e2e/server.spec.ts` (gateway started in the Playwright process on 127.0.0.1), `e2e/settings.spec.ts`.

- [ ] Failing e2e: paste the token from the admin socket, the page shows the connection fingerprint equal to the operator's; after approval the card shows the host, `Online` and the device id; "Odpojiť server" asks for confirmation, shows the revoke command and returns to the pairing form; an invalid token shows an inline error; in Nastavenia the server orders are disabled without a pairing and selectable after pairing, and the choice persists.
- [ ] Copy follows the mockup's Server tab, without route auto-detection (the card shows the endpoint host).
- [ ] Commit `feat(desktop): Server page with token pairing and engine order setting`.

### Task 10: Report and review

- [ ] Full `pnpm lint`, `pnpm typecheck`, `pnpm test`, full desktop e2e once.
- [ ] Optional real-server check through `ssh -N -L 18787:127.0.0.1:8787 codex@192.168.1.110`, revoke the test device afterwards.
- [ ] `coderabbit review --agent --base main`, fix valid findings.
- [ ] `docs/reports/2026-10-26-remote-engine-report.md`, commit.
