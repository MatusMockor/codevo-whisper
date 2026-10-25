# Codevo Whisper - Design

Status: draft v3, 2026-10-25 (v1 reviewed by gpt-6.1-sol; v3 folds in the phase 0 findings from `docs/spikes/` and reorders the phases)
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
- Transcript history. Nothing is stored; only the last transcript lives in memory.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Client stack | Electron + TypeScript |
| Server stack | TypeScript gateway (Node) + STT engine sidecar in Docker |
| STT engine | transcribe.cpp (handy-computer) with Parakeet Ultra F16 GGUF, whisper.cpp as alternative. Vulkan on the Linux server, Metal on macOS. Pinned upstream commit |
| Server instance | Codevo Whisper runs its own STT instance; the aivora `:8001` sidecar is not used |
| Transport | Any: LAN, WireGuard, Tailscale, Cloudflare Tunnel. The app layer is end-to-end encrypted |
| Where transcription runs | User setting: **Lokálne** (this computer, downloaded model), **Server** (own server over E2E) or both with an order and fallback. Owner decision 2026-10-25 |
| Local mode | Supported. Models downloaded only on explicit user action from a pinned catalog with SHA-256 verification. Catalog chosen from `docs/research/stt-models.md` |
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
│   LastTranscript   ModelManager   SettingsStore   ServerStore   UpdateService│
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

- No transcript history (owner decision 2026-10-25): the app never writes audio or transcripts to disk. Only the last transcript is kept in memory (for "Vložiť posledný prepis" and the tray) and is gone when the app quits.
- Device private key and pinned server keys are stored via Electron `safeStorage`.
- On Linux, `safeStorage` can fall back to `basic_text` (no real protection). The app checks the backend; without a secure backend it asks the user for a passphrase to protect the device key (or warns clearly if they decline).
- Electron hardening: renderer sandbox, `contextIsolation`, no Node in renderers, strict CSP, navigation and new-window blocked, narrow validated IPC, transcripts rendered as text only, keys never cross into a renderer.

### 4.7 Implementation and review

- Primitives: `@noble/curves`, `@noble/ciphers`, `@noble/hashes`. Noise state machine: a maintained TypeScript library if one passes the official test vectors for both patterns, otherwise our own implementation in `packages/protocol` that must pass them.
- Beyond vectors: adversarial tests (tampering, replay, reordering, truncation, wrong keys, wrong prologue, oversize frames) and fuzzing of the framing and message parsers.
- Reviews: gpt-6.1-sol review of the protocol package before the first release. A human cryptographic review is recommended before the project makes public security claims beyond the README's threat model.

## 5. Desktop app

### 5.1 Hotkeys

Push-to-talk needs reliable key-down and key-up events, which Electron `globalShortcut` does not provide.

- macOS: Swift helper with a listen-only `CGEventTap` (Input Monitoring only), keycode + device-dependent modifier masks so left and right keys are distinguished; supported keys: Fn (63), left/right Option (58/61), right Command (54), right Control (62). Resets state on sleep, screen lock, a 120 s maximum or lost events. `uiohook-napi` rejected in phase 0 (no Fn, no left/right release distinction, needs Accessibility).
- Linux Wayland: XDG GlobalShortcuts portal, using `Activated` / `Deactivated` signals where supported.
- Linux X11: key grab via a small helper.
- Toggle mode (press to start, press to stop) is always available as a fallback.
- The hotkey is user-configurable in settings through a key recorder (press the key you want). First run asks the user to press their key instead of assuming one: the Fn/Globe key is invisible to macOS on many third-party keyboards, and some keyboards have no right Option. Suggested defaults in the recorder: Fn/Globe on Apple keyboards, right Control or right Option otherwise. Owner decision 2026-10-25 after the phase 0 test (an external keyboard without right Option, Fn not seen by the event tap, right Control worked).

### 5.2 Insertion

- When recording starts, the app records the insertion target (frontmost app / window id where the platform allows) and warms up the accessibility query for it.
- Before inserting it runs three checks: the target is still frontmost, secure input is off, and the accessibility focused element is editable (text field, text area, combo/search field, or text `AXValue` / `AXSelectedTextRange`). For Chromium/Electron targets it sets `AXManualAccessibility` once per process.
- Editable true or unknown: clipboard paste. Editable false (Finder, desktop, file lists, sliders): no paste, the transcript stays on the clipboard and the overlay says "Skopírované - vlož cez ⌘V". Focus changed or secure input: no paste, the text stays as the last transcript and the overlay offers "Kopírovať".
- Clipboard paste on macOS: save clipboard, write text, post Command down, V down, V up, Command up (posting V with only the Command flag can leave Command logically held - phase 0 bug), then restore the clipboard after 500 ms only if its content is still what the app wrote.
- "Vložiť posledný prepis": Ctrl+Cmd+V and a tray menu item paste the last transcript with the same checks (as in Wispr Flow).
- Platform matrix (v1):

| Platform | Direct insertion | Fallback |
|---|---|---|
| macOS | CGEvent Cmd+V via helper (Accessibility) | clipboard |
| Linux X11 | `xdotool` | clipboard |
| Linux Wayland, wlroots | `wtype` (virtual-keyboard protocol) | clipboard |
| Linux Wayland, GNOME / KDE | XDG RemoteDesktop portal after one-time user consent (investigated in phase 0) | clipboard |

Clipboard fallback is the only behaviour guaranteed everywhere. `ydotool` is documented as an opt-in for users who set up `/dev/uinput` access themselves.

### 5.3 Overlay

- Two display modes, chosen in settings (owner decision 2026-10-25):
  - **Indikátor** (default): a small pill with a recording dot and a voice-level waveform, then a short processing and inserted state. No transcript text.
  - **Živý text**: the pill expands and shows the live transcript (confirmed words solid, tentative words lighter), as in the mockup.
  - In Indikátor mode the client does not request partials, so the server only transcribes committed segments and the final tail. This lowers server load and end-of-speech latency, which matters most with several devices (phase 0 latency spike).
- macOS: non-activating panel, `showInactive`, always on top including over fullscreen apps and across Spaces; verified in phase 0.
- Linux X11: frameless always-on-top window positioned bottom-center.
- Linux Wayland: Electron cannot reliably do `showInactive`, always-on-top or arbitrary positioning. v1 uses a reduced mode there (regular small window or system notification with the live text), clearly documented. A compositor-specific layer-shell backend is a later option.

### 5.4 Session and engines

- `DictationSession` state machine: `idle -> recording -> finishing -> cleaning (optional) -> inserting -> done | error`. Owns cancel, timeouts and recovery: on any failure the text recognised so far is kept as the last transcript and offered for copying.
- `TranscriptionEngine` (Strategy): `RemoteEngine` and `LocalEngine` with one interface (`start / pushAudio / finish / cancel`, events `partial` and `final` with segment ids and revisions).
- Engine selection happens before recording starts, never mid-session. Order is configurable (e.g. server, then local). Switching from local to remote must be explicitly allowed by the user. A missing local model never triggers a download.
- If the server drops mid-session, the client keeps a bounded audio buffer (up to 2 minutes) and can retry the whole session once on reconnect; segment ids prevent duplicate text.

### 5.5 Microphone selection

Owner decision 2026-10-25: the user chooses the input device, because many users have several (built-in, AirPods, iPhone via Continuity, USB or XLR interfaces, webcams).

- Settings > Mikrofón lists all inputs from `navigator.mediaDevices.enumerateDevices()` with a live level meter, plus "Systémový predvolený" (follows the macOS / PipeWire default). The tray menu has the same list as a submenu ("Mikrofón").
- The choice is stored by `deviceId` and label. If the device is missing at recording time (unplugged AirPods, iPhone out of range), the app records with the system default and the overlay shows a short notice ("Mikrofón X nie je pripojený, používam predvolený"). When the device comes back it is used again automatically.
- The list refreshes on `devicechange` (hot-plug) without restarting the app.
- Bluetooth headsets switch to a low-quality call profile while their microphone is in use, which also degrades music playback. The settings show a hint for Bluetooth inputs and suggest the built-in microphone while listening with AirPods (Wispr Flow gives the same advice).
- The microphone is opened only while recording (push-to-talk), never kept open in the background, so the macOS orange microphone indicator appears only during dictation. An optional "Rýchlejší štart" setting may keep the stream warm to avoid the first-word cut on slow devices; off by default.
- The level meter in settings and the overlay waveform use the same capture path, so "Povedzte niečo a sledujte úroveň" tests exactly what dictation will use.

### 5.6 Permissions and first run

- macOS: microphone (`NSMicrophoneUsageDescription`, `com.apple.security.device.audio-input`), Accessibility (paste), Input Monitoring (hotkey helper). First-run screens explain each and deep-link to System Settings.
- Linux: detect session type, available tools and portals; show what works and what falls back.

## 6. Live transcript and long dictation

Phase 0 measurements (`docs/spikes/rolling-latency.md`, `docs/spikes/transcribe-macos.md`): on the server one call costs about 400 ms fixed plus about 7 ms per second of audio, and the fixed part is mostly process start and model load because the aivora sidecar spawns `transcribe-cli` per request. Our STT sidecar and LocalEngine keep the model resident if the pinned transcribe.cpp offers a library or server mode (to verify when building them). On Apple Silicon with Metal a warm call takes 0.16 s for 6.7 s of audio.

- Audio is buffered where transcription runs (gateway or LocalEngine).
- Partials only in Živý text mode. The uncommitted tail is re-transcribed on an adaptive interval: 1 s with one active device, `active devices x 1 s` with more (about one partial call per second in total), clamped to 1-3 s; sent as `partial` with a revision number.
- Commit rules: when the tail exceeds 15 s and the VAD finds a pause of at least 200 ms, commit up to the longest pause found. When no pause appears by 25 s, cut anyway with a 1 s overlap. Each committed segment includes about 0.5 s of audio before the cut, and duplicate words across a boundary are removed with fuzzy matching (exact matching missed inflected forms in phase 0). The VAD uses an adaptive noise floor (a fixed threshold only works on clean TTS audio).
- Every engine call stays under the engine's per-call limit for the pinned version (transcribe.cpp handles longer audio, but the policy keeps calls short for latency).
- Finalization has priority over partials. Partials are dropped when the engine is busy.
- With several devices on one server, the queue is fair per device and partials from other devices are dropped before finals.
- Acceptance: one device partial p95 <= 0.8 s, end of speech to final text p50 <= 1.0 s and p95 <= 1.3 s; two devices p95 <= 1.3 s per device, no busy error reaching a client.

The policy lives in `packages/audio` and is shared by the gateway and LocalEngine.

### Optional cleanup

"Uhladiť text" sends the final text to Ollama with a fixed prompt (punctuation, fillers, capitalization, no rewording), with a time limit and only that text as context. Off by default. The raw text is kept as the last transcript and the overlay offers "Vrátiť pôvodný" after insertion. If cleanup fails or times out, the raw text is inserted. On the server the gateway reaches the host Ollama via an explicit `host.docker.internal` / host-gateway mapping documented in compose.

## 7. Local mode and model management

- Engines bundled per platform: transcribe.cpp (and whisper.cpp if the catalog needs it) at pinned commits, built in CI for macOS arm64/x64 and Linux x64/arm64 (Vulkan with CPU fallback). macOS build flags: `-DTRANSCRIBE_METAL=ON -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DTRANSCRIBE_BUILD_TESTS=OFF -DGGML_NATIVE=OFF`, `CMAKE_OSX_ARCHITECTURES` per arch (Metal must be set explicitly for x64). Signed with hardened runtime and an explicit identifier (`app.codevo.whisper.transcribe-cli`); no entitlements needed.
- Phase 0 result: Parakeet Ultra F16 with Metal on Apple Silicon is a go (exact Slovak transcript, 0.16 s warm). Intel Macs default to the CPU backend (1.8 s for 6.7 s under Rosetta) with Metal opt-in until verified on real Intel hardware.
- The first Metal run after install or update compiles shaders (about 3 s); the app runs a silent warm-up after each install or update.
- Catalog: JSON manifest bundled with the app: id, name, engine, languages, size, license, attribution, source (Hugging Face repo + pinned revision + file), SHA-256, roles (e.g. Odporúčaný, Najrýchlejší, Pre slabší počítač), minimum RAM. Entries come from the model research (`docs/research/stt-models.md`, `docs/research/model-catalog.draft.json`); Parakeet Ultra F16 is the expected default on Apple Silicon.
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
- macOS: hardened runtime, entitlements from 5.6, every native helper and engine binary signed, notarized with the App Store Connect API key, stapled.
- Linux: AppImage + deb, `SHA256SUMS`. Phase 0 finding: electron-updater verifies only the sha512 from the same feed on Linux (no publisher signature), and the deb updater installs as root via `dpkg`/`apt --allow-unauthenticated`. Decision: in-app auto-update on Linux only for the AppImage; deb users get an in-app notice with a download link (a signed apt repository is a later option). The README states that Linux AppImage updates are verified by HTTPS and checksums only.
- Auto-update via electron-updater (GitHub provider). Verified in phase 0 (`docs/spikes/signed-update.md`): N -> N+1 works on arm64 and x64; Squirrel.Mac rejects an update not signed by Team ID U574W69TH6 with bundle ID `app.codevo.whisper`, so both must never change. Build jobs run with `--publish never`; one publish job merges the two `latest-mac.yml` files (both ZIPs listed), verifies the feed, uploads everything to a draft release, re-verifies and then publishes the draft. Artifact names `codevo-whisper-${version}-${arch}-${os}.${ext}`. Linux writes `latest-linux.yml` and `latest-linux-arm64.yml` itself.
- DMGs are notarized and stapled separately from the app (electron-builder only notarizes the `.app`). Notarization latency is unbounded (the first submissions of this team took more than 2 hours): jobs use explicit timeouts and keep the submission ID for `notarytool wait`.
- Electron fuses (phase 0 finding): `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`, `enableCookieEncryption: true`. With the defaults any local process could run code under our signature and inherit the microphone, Accessibility and Input Monitoring grants. CI checks the fuses with `@electron/fuses read`; the N -> N+1 update test is repeated with them.
- CI gates per arch: `codesign --verify --deep --strict`, `spctl --assess --type execute -vv` (`source=Notarized Developer ID`), `xcrun stapler validate` on app and DMG.
- The x64 macOS build stays while Intel Macs are supported by Apple; on Apple Silicon it runs under Rosetta and macOS warns that Intel apps are ending, so the updater must always serve the arm64 build to Apple Silicon (it does: `isRosetta` selects the arm64 ZIP).
- Server images built and pushed to GHCR in the same workflow.
- Secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, variable `APPLE_TEAM_ID`. Set by the owner with `gh secret set`.

## 11. Open questions

1. Wayland on GNOME/KDE: does the RemoteDesktop portal give acceptable insertion UX, or does v1 ship clipboard-only there? (Linux spike, start of phase 4.)
2. X11 hotkey helper (macOS uses the Swift helper).
3. Noise library: existing maintained TS implementation passing the vectors, or our own. The protocol plan assumes our own over `@noble` primitives.
4. License for the public repo.
5. Model catalog entries and per-platform defaults (model research in progress).
6. Resident model in transcribe.cpp (library or server mode) to avoid per-call process start.

## 12. Phases

Each phase ends with lint, typecheck, tests, CodeRabbit review and the owner's OK. Plans live in `docs/plans/`.

Order changed 2026-10-25 (owner decision): the macOS app with local mode comes first, so there is a usable app before the server exists.

0. **Risk spikes - done** (`docs/spikes/`), except the notarized-run part of the update spike (waiting for Apple) and the Linux spike (moved to phase 4).
1. **macOS app + local mode.** Full UI per the mockup without history (Domov, Server placeholder, Nastavenia, Súkromie, tray menu, overlay with Indikátor and Živý text modes), hotkey recorder and Swift helper, audio capture with microphone selection (5.5), insertion with the checks from 5.2, paste last transcript, first-run permissions, LocalEngine with transcribe.cpp, ModelManager with the catalog (download, verify, delete, warm-up), engine setting "Kde beží prepis" (Lokálne now, Server once phase 2 lands), Electron hardening (4.6) and fuses. Transcription after key release, cut into chunks of at most 25 s; no partials yet.
2. **Protocol + server core + RemoteEngine.** Everything in `docs/plans/2026-10-25-phase-2-protocol-server.md` plus RemoteEngine, pairing UI (token paste) and the server option in "Kde beží prepis".
3. **Segmentation and live text.** `packages/audio` policy with the phase 0 numbers, partials for Živý text in both engines, fairness on the server.
4. **Linux desktop.** Starts with the deferred Linux spike. Then hotkeys, insertion matrix, reduced Wayland overlay, safeStorage backend handling.
5. **Release.** CI matrix, signing, notarization, auto-update tests, GHCR images, first public release.
6. **Cleanup (Ollama).** Optional text cleanup with raw-text fallback.
