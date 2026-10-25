# Phase 0 - Risk Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the five riskiest open questions with throwaway prototypes and write the answers back into the spec before production code starts.

**Architecture:** Each spike is an isolated folder under `spikes/<name>/` with its own minimal setup and a findings file `docs/spikes/<name>.md`. Spike code is not reused by later phases; only the findings are. Spikes are independent and can run in parallel.

**Tech Stack:** Electron (latest stable), TypeScript, Node 24 LTS, pnpm 10, electron-builder, Swift (macOS helper candidate), uiohook-napi (helper candidate), transcribe.cpp at commit `8facde6fcd8fb9caa585a5788ab450df6e8ec7db`, bash scripts against the home server.

**Spec:** `docs/specs/2026-10-25-codevo-whisper-design.md` (sections 5, 6, 7, 10, 11, 12 phase 0)

## Global Constraints

- Platforms: macOS arm64 + x64, Linux x64 + arm64. No Windows.
- Bundle ID `app.codevo.whisper`; signing identity `Developer ID Application: codevo s.r.o. (U574W69TH6)`; notarization key ID `BZCV89264Q`, issuer `dff553bd-192a-4952-81fd-6c3e05f2c806`, key file `~/Documents/certs/AuthKey_BZCV89264Q.p8`. Never copy the key or the `.p12` into the repo; reference them by path or env var only.
- Home server: `codex@192.168.1.110`, Ubuntu 26.04, GNOME on Wayland, RX 7800 XT (Vulkan). Existing aivora services must not be stopped or reconfigured.
- Spike code may be rough, but no secrets, no network calls to third parties other than GitHub/Hugging Face downloads of pinned artifacts.
- No code comments (owner's rule). Findings go into the findings file, not into code.
- Packaging builds are allowed in this phase because the build output is what is being verified.

## Review Focus

- Push-to-talk key-up lost (app switch, sleep, screen lock while holding): the session must end and the hotkey must work again on the next press. Pinned in Task 1 Step 3.
- Paste target changed during transcription: text must not land in the new app. Pinned in Task 1 Step 4.
- Overlay over a fullscreen app and on a second Space: must stay visible and must not steal focus. Pinned in Task 1 Step 2.
- Intel Mac: transcribe.cpp x64 build must run (Metal or CPU) or local mode must be marked arm64-only. Pinned in Task 3 Step 3.
- Two dictating clients on one server: latency of the second client must stay usable. Pinned in Task 5 Step 3.

---

### Task 1: macOS hotkey -> overlay -> paste spike

**Files:**
- Create: `spikes/macos-input/` (Electron app + helper candidates)
- Create: `docs/spikes/macos-input.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a decision recorded in `docs/spikes/macos-input.md`: helper technology (Swift helper binary vs `uiohook-napi`), overlay window options that work, paste method and clipboard restore timing, and required permissions. Phase 3 implements against these findings.

- [ ] **Step 1: Hotkey down/up**
  Build two minimal candidates that report `down` and `up` for right Option (keycode 61) and Fn separately from left Option (keycode 58): (a) `uiohook-napi` in the Electron main process, (b) a Swift CLI helper using `CGEventTap` that writes `down`/`up` JSON lines to stdout, spawned by Electron. Record for each: works signed/unsigned, permission prompts (Input Monitoring / Accessibility), behaviour when Fn is also bound to the macOS emoji picker or dictation.
  Expected: at least one candidate delivers reliable down/up for right Option.

- [ ] **Step 2: Non-activating overlay**
  Create a frameless transparent `BrowserWindow` (`type: 'panel'`, `focusable: false`, `alwaysOnTop` level `screen-saver`, `visibleOnAllWorkspaces` with `visibleOnFullScreen: true`), shown with `showInactive()` at bottom-center of the display under the cursor. Verify over: Slack, VS Code, Terminal, Safari fullscreen video, a second Space.
  Expected: overlay visible in all five, the frontmost app keeps keyboard focus (typing continues to go to it).

- [ ] **Step 3: Lost key-up**
  While holding the hotkey: Cmd+Tab to another app; lock the screen (Ctrl+Cmd+Q); close the lid for sleep. Record whether `up` arrives. Implement and test a reset rule: a session ends if no `up` arrives within the push-to-talk maximum (default 120 s) or on `powerMonitor` `lock-screen`/`suspend`.
  Expected: after each case the next press starts a new session.

- [ ] **Step 4: Paste with focus check and clipboard restore**
  On key-up: remember the frontmost app (`NSWorkspace.frontmostApplication` via helper or `osascript`) at key-down, wait 1 s (simulated transcription), compare with the current frontmost app; if equal, save clipboard, write text, send Cmd+V via CGEvent, then restore the clipboard after a delay only if its content is still the inserted text. Test in Slack, VS Code, Terminal, a password field (secure input), and with a focus change during the wait.
  Expected: text inserted in the three apps; password field detected (`IsSecureEventInputEnabled`) and falls back to clipboard; on focus change nothing is pasted. Record the smallest restore delay that works in all apps.

- [ ] **Step 5: Write findings and commit**
  Fill `docs/spikes/macos-input.md` with: chosen helper and why, exact window options, permission list with System Settings deep links, restore delay, failures seen.

```bash
git add spikes/macos-input docs/spikes/macos-input.md
git commit -m "spike: macOS hotkey, overlay and paste findings"
```

---

### Task 2: Linux hotkey and insertion spike

**Files:**
- Create: `spikes/linux-input/`
- Create: `docs/spikes/linux-input.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the v1 Linux support matrix (spec 5.2) filled with tested results for GNOME Wayland and X11, and the hotkey mechanism per session type.

- [ ] **Step 1: GlobalShortcuts portal on GNOME Wayland**
  On the home server's GNOME Wayland session (needs the owner at the machine or a remote desktop session), call `org.freedesktop.portal.GlobalShortcuts` (`CreateSession`, `BindShortcuts`) from a small Node script via `dbus-next`, bind one shortcut, and log `Activated`/`Deactivated` signals.
  Expected: record whether both signals arrive with timestamps (push-to-talk viable) or only `Activated` (toggle only).

- [ ] **Step 2: Insertion on GNOME Wayland**
  Test in gedit/GNOME Text Editor and a terminal: (a) `wtype "test"`, (b) XDG RemoteDesktop portal `NotifyKeyboardKeysym` after `SelectDevices` consent, (c) `ydotool` with `ydotoold` (only if `/dev/uinput` access can be granted without running the app as root), (d) clipboard via `wl-copy` + manual paste.
  Expected: a table of works/fails per method, consent UX notes for (b).

- [ ] **Step 3: X11 session**
  Log into an "Ubuntu on Xorg" session if available (or a Docker/Xvfb X11 desktop) and test key grab via `uiohook-napi` and insertion via `xdotool type` and clipboard+`xdotool key ctrl+v`.
  Expected: works/fails table for X11.

- [ ] **Step 4: Electron overlay on Wayland**
  Run the overlay window from Task 1 Step 2 with `--ozone-platform=wayland` and with XWayland. Record which options are honoured (always on top, position, focus).
  Expected: a decision for the reduced Wayland overlay mode (spec 5.3).

- [ ] **Step 5: Write findings and commit**

```bash
git add spikes/linux-input docs/spikes/linux-input.md
git commit -m "spike: Linux hotkey and insertion findings"
```

---

### Task 3: transcribe.cpp on macOS (Metal)

**Files:**
- Create: `spikes/transcribe-macos/build.sh`
- Create: `spikes/transcribe-macos/run.sh`
- Create: `docs/spikes/transcribe-macos.md`

**Interfaces:**
- Consumes: Slovak sample WAV, downloaded once from the home server: `ssh codex@192.168.1.110 'curl -s 127.0.0.1:8015/sample.wav' > spikes/transcribe-macos/sample.wav` (16 kHz mono, 6.71 s). Expected transcript: `Ahoj, toto je skúška prepisu slovenskej reči na grafickej karte. Potrebujem skontrolovať náš editor a potom odoslať zmenu.`
- Produces: exact CMake flags, binary size, latency numbers and a go/no-go for Parakeet in local mode on macOS (spec 7, open question resolved).

- [ ] **Step 1: Build arm64 with Metal**
  `build.sh`: clone `https://github.com/handy-computer/transcribe.cpp.git`, check out `8facde6fcd8fb9caa585a5788ab450df6e8ec7db`, configure with the Metal option documented upstream (check `docs/` and `CMakeLists.txt` for the exact flag name), `-DTRANSCRIBE_BUILD_TESTS=OFF -DGGML_NATIVE=OFF`, build target `transcribe-cli`.
  Expected: `build/bin/transcribe-cli` exists and `file` reports `arm64`.

- [ ] **Step 2: Run Parakeet Ultra F16**
  Download the model with the pinned values: revision `a1539be1b849ea7463b88343e5277b373d0c4ea9`, URL `https://huggingface.co/handy-computer/parakeet-ultra-gguf/resolve/a1539be1b849ea7463b88343e5277b373d0c4ea9/parakeet-ultra-F16.gguf`, SHA-256 `cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d` (verify with `shasum -a 256`). `run.sh` runs `transcribe-cli --model <gguf> --backend metal --language sk --threads 4 --timestamps none --quiet --output out.txt sample.wav` five times and prints wall time.
  Expected: `out.txt` matches the expected transcript (punctuation differences allowed); median wall time recorded.

- [ ] **Step 3: x64 build**
  Build an `x86_64` binary (`-DCMAKE_OSX_ARCHITECTURES=x86_64`), run it under Rosetta with `--backend metal` and with the CPU backend.
  Expected: record whether it runs and the latency of each; decide whether Intel Macs get Parakeet locally or whisper.cpp only.

- [ ] **Step 4: Signed binary**
  Sign the arm64 binary with `codesign --options runtime --timestamp -s "Developer ID Application: codevo s.r.o. (U574W69TH6)"` and run it again.
  Expected: runs under hardened runtime; record any entitlement needed (e.g. JIT is not expected).

- [ ] **Step 5: Write findings and commit**
  Do not commit the model or binaries (`spikes/transcribe-macos/.gitignore` with `*.gguf`, `build/`, `transcribe.cpp/`, `out.txt`, `sample.wav`).

```bash
git add spikes/transcribe-macos docs/spikes/transcribe-macos.md
git commit -m "spike: transcribe.cpp Metal findings"
```

---

### Task 4: Signed, notarized Electron app with auto-update

**Files:**
- Create: `spikes/signed-update/` (minimal Electron app showing its version, electron-builder config, local update server script)
- Create: `docs/spikes/signed-update.md`

**Interfaces:**
- Consumes: signing identity in the login keychain; notarization env vars `APPLE_API_KEY=~/Documents/certs/AuthKey_BZCV89264Q.p8`, `APPLE_API_KEY_ID=BZCV89264Q`, `APPLE_API_ISSUER=dff553bd-192a-4952-81fd-6c3e05f2c806` set in the shell only.
- Produces: a working electron-builder mac config (hardened runtime, entitlements file, notarize), the merged `latest-mac.yml` procedure for two architectures, and Linux update verification findings (spec 10, open question 5).

- [ ] **Step 1: Build v0.0.1 for arm64 and x64**
  electron-builder config: `appId: app.codevo.whisper`, `productName: Codevo Whisper Spike`, mac targets `dmg` and `zip` for `arm64` and `x64`, `hardenedRuntime: true`, entitlements with `com.apple.security.device.audio-input`, `notarize: true`, publish provider `generic` pointing at `http://127.0.0.1:8099/`.
  Expected: `spctl --assess --type execute -vv` on both `.app` bundles reports `accepted` and `source=Notarized Developer ID`; `xcrun stapler validate` passes on both DMGs.

- [ ] **Step 2: Merged mac manifest**
  Build v0.0.2 for both architectures in separate runs, merge the two `latest-mac.yml` files into one listing both ZIPs, serve the folder with `npx http-server -p 8099`.
  Expected: the merged manifest validates against what electron-updater expects (both `files` entries with `sha512` and `size`).

- [ ] **Step 3: N -> N+1 update on both architectures**
  Install v0.0.1 arm64, trigger `autoUpdater.checkForUpdates()`, download, `quitAndInstall()`; repeat for x64 under Rosetta.
  Expected: both relaunch showing `0.0.2`; record any signature or Gatekeeper prompt.

- [ ] **Step 4: Linux update verification**
  Read the electron-builder / electron-updater docs and source for Linux AppImage/deb update verification (publisher signature, `sha512` in `latest-linux.yml`). Record what is verified and what is not.
  Expected: a short recommendation for spec section 10.

- [ ] **Step 5: Write findings and commit**
  `.gitignore` excludes `dist/`, `release/`, any `*.p8`, `*.p12`.

```bash
git add spikes/signed-update docs/spikes/signed-update.md
git commit -m "spike: signed, notarized auto-update findings"
```

---

### Task 5: Rolling re-transcription latency on the home server

**Files:**
- Create: `spikes/rolling-latency/measure.ts`
- Create: `docs/spikes/rolling-latency.md`

**Interfaces:**
- Consumes: aivora STT `127.0.0.1:8001` (`POST /transcribe?language=sk`, body PCM16 LE mono 16 kHz, 640 to 960000 bytes, returns `{ "text": string }`, `503` when busy) and aivora TTS `127.0.0.1:8002` (`POST /synthesize` with `{ "text": string }`) to generate continuous Slovak speech. Run on the server or through `ssh -L 8001:127.0.0.1:8001 -L 8002:127.0.0.1:8002`. Read-only use; do not restart either service.
- Produces: measured numbers that set the defaults in spec section 6 (interval, target length, hard limit) and the acceptance thresholds for phase 2.

- [ ] **Step 1: Test audio**
  Synthesize about 60 s of continuous Slovak text without long pauses via the TTS service, convert to PCM16 16 kHz mono (`ffmpeg -ar 16000 -ac 1 -f s16le`), store outside git.
  Expected: a PCM file of about 1.9 MB.

- [ ] **Step 2: Single client simulation**
  `measure.ts` streams the audio in real time (100 ms frames). Every 1 s it re-transcribes the uncommitted tail; at 15 s with a pause, or at 25 s without, it commits. It logs per call: tail length, request latency, 503 count.
  Expected: table of latency vs tail length; p50/p95 for tails of 5, 10, 15, 20, 25 s.

- [ ] **Step 3: Two clients**
  Run two simulations concurrently against the same STT (it is single-flight, so measure queueing as well).
  Expected: p95 end-of-speech-to-final latency per client; decide whether partials must be throttled when more than one device is active.

- [ ] **Step 4: Write findings and commit**

```bash
git add spikes/rolling-latency docs/spikes/rolling-latency.md
git commit -m "spike: rolling re-transcription latency findings"
```

---

### Task 6: Fold findings into the spec

**Files:**
- Modify: `docs/specs/2026-10-25-codevo-whisper-design.md` (sections 5.1-5.3, 6, 7, 10, 11)

**Interfaces:**
- Consumes: the five findings files.
- Produces: spec v3 with open questions 1, 2 and 5 answered and section 6 defaults replaced by measured values.

- [ ] **Step 1: Update the spec** with decisions and numbers from the findings; move answered items out of section 11.
- [ ] **Step 2: Owner review.** Present the diff to the owner; phase 1 starts after the OK.
- [ ] **Step 3: Commit**

```bash
git add docs/specs/2026-10-25-codevo-whisper-design.md
git commit -m "docs: spec v3 with phase 0 findings"
```
