# Codevo Whisper - Design

Status: draft v2 for review, 2026-10-25 (v1 reviewed by gpt-6.1-sol, findings incorporated)
Owner: Matus Mockor (codevo s.r.o.)
UI mockup: `~/.t3/scratch/2026-10-25-moja-otazka-pouzivam-t3-code-3289f38e/mockup/index.html`

## 1. Goal

A Wispr-Flow-like dictation app for macOS and Linux. Hold a hotkey, speak, see the transcript live in a floating overlay, release, and the text is inserted at the cursor of the focused app.

Audio and transcripts never go to a third-party cloud service. Transcription runs either on the user's own server (reached over any network, end-to-end encrypted) or locally on the user's machine with a downloaded model.

Public open-source project, released as signed builds.

### Non-goals (v1)

- Windows.
- Mobile clients.
- Multi-user server accounts or sharing one server between untrusted people. A server serves the devices its owner paired.
- Cloud STT providers.
- Real streaming ASR models. Live text uses rolling re-transcription (section 6).
- Hiding traffic metadata. Network observers can still see addresses, timing and message sizes.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Client stack | Electron + TypeScript |
| Server stack | TypeScript gateway (Node) + STT engine sidecar in Docker |
| STT engine | transcribe.cpp (handy-computer) with Parakeet Ultra F16 GGUF, whisper.cpp as alternative. Vulkan on the Linux server, Metal on macOS. Pinned upstream commit |
| Server instance | Codevo Whisper runs its own STT instance; the aivora `:8001` sidecar is not used |
| Transport | Any: LAN, WireGuard, Tailscale, Cloudflare Tunnel. The app layer is end-to-end encrypted |
| Local mode | Supported. Models downloaded only on explicit user action from a pinned catalog with SHA-256 verification |
| Repo | Public GitHub repo under the personal account `MatusMockor`; releases and auto-update from GitHub Releases |
| Release targets | macOS arm64 + x64 (DMG + zip, Developer ID signed, notarized), Linux x64 + arm64 (AppImage + deb) |
| Bundle ID | `app.codevo.whisper` |
| Signing identity | `Developer ID Application: codevo s.r.o. (U574W69TH6)`, notarization via App Store Connect API key `BZCV89264Q` |

## 3. Architecture

```
┌─────────────────────────── Desktop app (Electron) ───────────────────────────┐
│ Renderer (sandboxed, no Node): overlay, main window, tray menu UI            │
│ AudioWorklet -> PCM16 16 kHz mono frames -> narrow validated IPC              │
│                                                                             │
│ Main process (holds all keys and secrets):                                  │
│   HotkeyBackend ── DictationSession (state machine) ── InsertionTarget/Inserter│
│                          │                                                  │
│                 TranscriptionEngine (Strategy)                              │
│                 ├─ RemoteEngine ── SecureChannel (Noise) ── WebSocket ──────┼──► any network
│                 └─ LocalEngine  ── engine binary child process + model file │
│   HistoryStore   ModelManager   SettingsStore   ServerStore   UpdateService  │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────── Server (Docker compose) ─────────────────────────┐
│ gateway (Node/TS), published on 127.0.0.1 or the VPN address only            │
│   WebSocket ── PreAuthLimiter ── SecureChannel ── DeviceRegistry              │
│   SessionManager ── SegmentPolicy ── TranscriptionQueue ── SttClient ──► stt  │
│   optional TextCleanup ──► Ollama                                            │
│   CLI: codevo-whisper pair | devices | revoke | rotate-key | status          │
│ stt sidecar: transcribe.cpp / whisper.cpp, GPU via /dev/dri, internal only    │
└─────────────────────────────────────────────────────────────────────────────┘
```

Monorepo (pnpm workspaces):

- `apps/desktop` - Electron app.
- `apps/server` - gateway + CLI.
- `apps/stt` - STT HTTP sidecar.
- `packages/protocol` - message schemas, Noise handshakes and transport, framing, pairing token format. Shared by both sides.
- `packages/audio` - PCM framing, VAD, segment and revision policy. Pure TypeScript.
- `packages/stt-runner` - wrapper around the engine binaries, shared by the sidecar and LocalEngine.
- `native/` - small native helpers (macOS hotkey + insertion helper), signed with the app.
- `infrastructure/compose` - server compose file.

## 4. Security

### 4.1 What "end-to-end" means here

The two ends are the user's device and the user's own gateway. Everything between them (Wi-Fi, ISP, VPN provider, Cloudflare) sees only ciphertext plus metadata (addresses, timing, sizes). The gateway decrypts because it must transcribe. Gateway -> STT and gateway -> Ollama traffic stays on the server host.

### 4.2 Pairing

- `codevo-whisper pair` on the server opens a pairing window (default 10 minutes, one device) and prints a pairing token as text and as a terminal QR code:
  `cw1:<server-static-public-key>:<128-bit random secret>:<endpoint hint>`
- The user pastes the token into the app (or scans the QR on a future mobile client). The token carries the server's static public key, so the client authenticates the server from the first message. No short codes, so no offline guessing.
- Handshake: `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s`. The PSK is the token secret. The prologue binds protocol version, role and mode (`cw1/pair`).
- The server then prints the device name and the device key fingerprint and asks the operator to confirm (`y/N`). The device becomes active only after the confirmation; until then the session can do nothing else.
- Both sides display a fingerprint derived from the handshake hash, which binds both static keys; the app shows it on the pairing screen for comparison.
- Token consumption is atomic: the first successful handshake consumes it, a failed or expired window closes it. Pairing is impossible while no window is open.
- A changed server key is never accepted automatically. The app shows a hard error and requires re-pairing.

### 4.3 Sessions

- `Noise_IK_25519_ChaChaPoly_BLAKE2s` with the pinned server key. The prologue binds `cw1/session`.
- The first handshake message is replayable by design, so handshake payloads carry nothing with side effects. Audio and commands are accepted only after the handshake completes and the server sends `ready`.
- Unknown device keys are rejected before any audio is accepted and before the STT is touched.
- Every connection starts a new handshake (fresh ephemeral keys). Nonces are never reset. Rekey per direction after a fixed number of messages using Noise `Rekey()`; sessions are closed after a maximum duration and must reconnect with a new handshake.

### 4.4 Framing and pre-auth hardening

- Binary WebSocket messages only, compression disabled. One WebSocket message carries exactly one Noise message, maximum 65,535 bytes including the tag. Fragmented or oversized frames close the connection.
- Before authentication: global and per-IP limits on concurrent connections and concurrent handshakes, a short handshake deadline, a small memory budget per pending connection.
- After authentication: per-device limits on session length, audio rate and queued work, with backpressure (the client pauses sending when the server signals it).

### 4.5 Keys, storage, revocation

- Server static private key: file in a dedicated volume, mode 0600, owned by the gateway user. `codevo-whisper rotate-key` generates a new key; all devices must re-pair (documented loss and rotation procedure).
- DeviceRegistry: device name, public key, paired-at, last-seen. Nothing else.
- `codevo-whisper revoke <device>` takes effect immediately: open connections of that device are closed, its running and queued jobs are cancelled and its buffers dropped.
- "Odpojiť server" in the app only deletes the local pairing; the UI says so and shows the server command for full revocation.
- The server does not intentionally persist audio or transcripts. Audio lives in memory only; core dumps are disabled in the containers; the STT sidecar is configured not to log content. Swap is outside the app's control and documented as such.
- Logs contain only sizes, durations and error codes.

### 4.6 Desktop data protection

- Device private key, pinned server keys and the history encryption key are stored via Electron `safeStorage`.
- On Linux, `safeStorage` can fall back to `basic_text` (no real protection). The app checks the backend; without a secure backend it does not persist history and asks the user for a passphrase to protect the device key (or warns clearly if they decline).
- History retention: default 30 days, configurable, can be off.
- Electron hardening: renderer sandbox, `contextIsolation`, no Node in renderers, strict CSP, navigation and new-window blocked, narrow validated IPC, transcripts rendered as text only, keys never cross into a renderer.

### 4.7 Implementation and review

- Primitives: `@noble/curves`, `@noble/ciphers`, `@noble/hashes`. Noise state machine: a maintained TypeScript library if one passes the official test vectors for both patterns, otherwise our own implementation in `packages/protocol` that must pass them.
- Beyond vectors: adversarial tests (tampering, replay, reordering, truncation, wrong keys, wrong prologue, oversize frames) and fuzzing of the framing and message parsers.
- Reviews: gpt-6.1-sol review of the protocol package before the first release. A human cryptographic review is recommended before the project makes public security claims beyond the README's threat model.

## 5. Desktop app

### 5.1 Hotkeys

Push-to-talk needs reliable key-down and key-up events, which Electron `globalShortcut` does not provide.

- macOS: native helper listening for the configured key via keycode and modifier state (left vs right Option distinguished), handling Fn conflicts, and resetting state on sleep, screen lock or lost events. Needs Input Monitoring permission.
- Linux Wayland: XDG GlobalShortcuts portal, using `Activated` / `Deactivated` signals where supported.
- Linux X11: key grab via a small helper.
- Toggle mode (press to start, press to stop) is always available as a fallback.

### 5.2 Insertion

- When recording starts, the app records the insertion target (frontmost app / window id where the platform allows).
- Before inserting it checks the target is still frontmost. If focus changed, it does not paste blindly: the overlay offers "Kopírovať" and the text stays in history.
- Clipboard paste: save clipboard, write text, send paste, wait for the paste to be consumed, then restore the clipboard only if its content is still what the app wrote. Secure input fields (macOS secure event input) block paste; the app detects and falls back to clipboard.
- Platform matrix (v1):

| Platform | Direct insertion | Fallback |
|---|---|---|
| macOS | CGEvent Cmd+V via helper (Accessibility) | clipboard |
| Linux X11 | `xdotool` | clipboard |
| Linux Wayland, wlroots | `wtype` (virtual-keyboard protocol) | clipboard |
| Linux Wayland, GNOME / KDE | XDG RemoteDesktop portal after one-time user consent (investigated in phase 0) | clipboard |

Clipboard fallback is the only behaviour guaranteed everywhere. `ydotool` is documented as an opt-in for users who set up `/dev/uinput` access themselves.

### 5.3 Overlay

- macOS: non-activating panel, `showInactive`, always on top including over fullscreen apps and across Spaces; verified in phase 0.
- Linux X11: frameless always-on-top window positioned bottom-center.
- Linux Wayland: Electron cannot reliably do `showInactive`, always-on-top or arbitrary positioning. v1 uses a reduced mode there (regular small window or system notification with the live text), clearly documented. A compositor-specific layer-shell backend is a later option.

### 5.4 Session and engines

- `DictationSession` state machine: `idle -> recording -> finishing -> cleaning (optional) -> inserting -> done | error`. Owns cancel, timeouts and recovery: on any failure the text recognised so far is kept in history and offered for copying.
- `TranscriptionEngine` (Strategy): `RemoteEngine` and `LocalEngine` with one interface (`start / pushAudio / finish / cancel`, events `partial` and `final` with segment ids and revisions).
- Engine selection happens before recording starts, never mid-session. Order is configurable (e.g. server, then local). Switching from local to remote must be explicitly allowed by the user. A missing local model never triggers a download.
- If the server drops mid-session, the client keeps a bounded audio buffer (up to 2 minutes) and can retry the whole session once on reconnect; segment ids prevent duplicate text.

### 5.5 Permissions and first run

- macOS: microphone (`NSMicrophoneUsageDescription`, `com.apple.security.device.audio-input`), Accessibility (paste), Input Monitoring (hotkey helper). First-run screens explain each and deep-link to System Settings.
- Linux: detect session type, available tools and portals; show what works and what falls back.

## 6. Live transcript and long dictation

Measured once on the target server: 6.7 s of Slovak speech in about 0.4 s (Parakeet Ultra F16, RX 7800 XT). This supports rolling re-transcription, but limits must be measured, not assumed.

- Audio is buffered where transcription runs (gateway or LocalEngine).
- The uncommitted tail is re-transcribed on an adaptive interval (target 1 s, longer when the engine is slower than real time) and sent as `partial` with a revision number.
- Commit rules: when the tail exceeds the target length (default 15 s) and the VAD finds a pause, commit up to the pause. When no pause appears by the hard limit (default 25 s), cut anyway with a 1 s overlap and deduplicate words across the boundary.
- Every engine call stays under the engine's per-call limit for the pinned version (transcribe.cpp handles longer audio, but the policy keeps calls short for latency).
- Finalization has priority over partials. Partials are dropped when the engine is busy.
- With several devices on one server, the queue is fair per device and partials from other devices are dropped before finals.
- Acceptance numbers measured in phase 0/2: end-of-speech to final text latency, CPU/GPU/RAM, with continuous speech, a slow CPU-only machine and two concurrent devices.

The policy lives in `packages/audio` and is shared by the gateway and LocalEngine.

### Optional cleanup

"Uhladiť text" sends the final text to Ollama with a fixed prompt (punctuation, fillers, capitalization, no rewording), with a time limit and only that text as context. Off by default. The raw text is always kept in history and the overlay offers "Vrátiť pôvodný" after insertion. If cleanup fails or times out, the raw text is inserted. On the server the gateway reaches the host Ollama via an explicit `host.docker.internal` / host-gateway mapping documented in compose.

## 7. Local mode and model management

- Engines bundled per platform: transcribe.cpp and whisper.cpp binaries at pinned commits, built in CI for macOS arm64/x64 (Metal, Intel with CPU fallback) and Linux x64/arm64 (Vulkan with CPU fallback), signed with the app on macOS.
- Catalog: JSON manifest bundled with the app: id, name, engine, languages, size, license, attribution, source (Hugging Face repo + pinned revision + file), SHA-256. Initial entries: Parakeet Ultra F16 GGUF (`handy-computer/parakeet-ultra-gguf`), whisper.cpp large-v3, one small whisper model for weak machines.
- Download only after the user clicks "Stiahnuť". Never at startup. Progress, cancel, resume. Written to a `.download` temp file, hashed while streaming, atomically renamed only when SHA-256 matches; mismatch deletes the file and reports an error.
- Models live in the app data directory; settings show size and allow deletion.
- Licenses and attributions of models and native binaries are listed in the app's "O aplikácii" screen and in the repo.

## 8. Server

- `docker compose up -d` brings up `gateway` and `stt`. Only the gateway publishes a port, on `127.0.0.1` by default (`CW_BIND` overrides it, e.g. the WireGuard address).
- `stt` gets the GPU via `/dev/dri` (Vulkan). Provisioning downloads and verifies the pinned model into a named volume. Startup never downloads.
- CLI in the gateway container: `codevo-whisper pair | devices | revoke <id> | rotate-key | status`.
- On the owner's server it runs as its own compose project next to aivora. Both share the RX 7800 XT (about 0.5 GB of 16 GB in use today); contention can raise latency and is part of the phase 0 measurements.
- Published as multi-arch images on GHCR plus the compose file in each release.

## 9. Testing

- `packages/protocol`: official Noise test vectors for both patterns; round trips; adversarial cases from 4.7; fuzzing of framing and parsers.
- `packages/audio`: segment, cut, overlap and dedup logic with recorded PCM fixtures including continuous speech without pauses.
- Gateway integration tests: real gateway, real protocol, real client, real WebSocket. The STT sidecar is replaced by a small fake HTTP server implementing its contract (separate GPU-bound service, not available in CI). No internal collaborators are mocked.
- Ciphertext check: a TCP proxy records all bytes between client and gateway; the test asserts that no PCM sample runs and no transcript text appear. This is a regression check, not a security proof.
- Pre-auth tests: connection floods, slow handshakes, oversized and fragmented frames, pairing attempts without an open window.
- Revocation test: revoke during an active session closes it and cancels its jobs.
- Real-model smoke test on the home server with the recorded Slovak sample.
- Desktop: unit tests for the session state machine, engine selection and inserter command building; Playwright for Electron UI flows; per-platform manual checklist for permissions, hotkeys, overlay and insertion.
- Day-to-day verification is lint + typecheck + tests. Packaging builds are run where the build output is the thing being verified (phase 0 spikes, Docker images, release workflow).

## 10. Release

- GitHub Actions, triggered by a `vX.Y.Z` tag or manual dispatch. Lint, typecheck and tests gate publishing.
- Build jobs per target on native runners: macOS arm64, macOS x64, Linux x64, Linux arm64. One publish job runs only after the whole matrix succeeded.
- Unambiguous artifact names per architecture. ZIPs for both macOS architectures (needed by the updater) next to the DMGs.
- macOS: hardened runtime, entitlements from 5.5, every native helper and engine binary signed, notarized with the App Store Connect API key, stapled.
- Linux: AppImage + deb, `SHA256SUMS`. Publisher verification for Linux updates is investigated in phase 0; until then the README documents that Linux updates are verified only by HTTPS and checksums.
- Auto-update via electron-updater (GitHub provider): merged `latest-mac.yml`, `latest-linux.yml`, blockmaps. The release workflow is accepted only after an N -> N+1 update test on each architecture with signed helpers.
- Server images built and pushed to GHCR in the same workflow.
- Secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, variable `APPLE_TEAM_ID`. Set by the owner with `gh secret set`.

## 11. Open questions

1. Wayland on GNOME/KDE: does the RemoteDesktop portal give acceptable insertion UX, or does v1 ship clipboard-only there?
2. Native hotkey helper: Swift helper vs. maintained npm native module (uiohook-based) for macOS and X11.
3. Noise library: existing maintained TS implementation passing the vectors, or our own. Phase 1 plan assumes our own over `@noble` primitives.
4. Linux update publisher verification options in electron-builder / electron-updater.
5. License for the public repo.

## 12. Phases

Each phase ends with lint, typecheck, tests, CodeRabbit review and the owner's OK. Plans live in `docs/plans/`.

0. **Risk spikes (throwaway code, findings written back into this spec).** macOS hotkey/overlay/paste; transcribe.cpp on macOS Metal; signed + notarized auto-update on both macOS architectures; rolling re-transcription latency with continuous speech and two clients.
1. **Protocol + server core.** Pairing token, IKpsk2 pairing, IK sessions, framing, vectors, adversarial tests, gateway with pre-auth limits, DeviceRegistry, CLI incl. revoke/rotate, STT sidecar + provisioning, compose, dev client, home-server smoke test.
2. **Segmentation.** `packages/audio` policy (partials, commits, hard cut, overlap/dedup, fairness) wired into the gateway.
3. **macOS desktop MVP.** Hotkey, capture, overlay, RemoteEngine, insertion with focus checks, tray, pairing UI (token paste), settings, history, hardening from 4.6.
4. **Linux desktop.** Starts with the deferred Linux spike (Wayland and X11 hotkey and insertion options). Then hotkeys, insertion matrix, reduced Wayland overlay, safeStorage backend handling.
5. **Local mode.** Engine binaries per platform, ModelManager, catalog with licenses, engine selection rules.
6. **Release.** CI matrix, signing, notarization, auto-update tests, GHCR images, first public release.
7. **Cleanup (Ollama).** Optional text cleanup with raw-text fallback.
