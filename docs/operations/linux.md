# Linux dictation

The initial Linux target is Ubuntu 24.04 with GNOME 46 on x64 or arm64. X11 supports guarded automatic paste. GNOME Wayland uses physical evdev shortcuts, a reduced regular overlay window and clipboard delivery for manual paste. Automatic insertion and replay on Wayland never receive a target authorization.

Packaged builds start the native input helper as a transient service of the current user's systemd manager. This avoids inheriting Electron's named user-namespace profile, which prevents accessibility communication with confined Snap applications. A working user manager, `systemd-run` and `systemctl` are required. The deb declares `systemd`. Each helper instance owns a unique collected unit. Closing the app sends EOF. A stuck runner is terminated and its unit is stopped before replacement.

In Settings > Prístup k systému, click **Povoliť rozpoznávanie polí** to enable system accessibility for applications such as Firefox and Zen. The same action is available during onboarding. It enables the AT-SPI toolkit bridge, not the screen reader. Automatic insertion still requires a verified editable field in the original active window. Unsupported applications retain clipboard recovery.

## Runtime prerequisites

Run Codevo Whisper as your normal desktop user. Never run the application or helper as root. The application does not change groups, device permissions, compositor settings or sandbox configuration.

The native helper requires GTK3/GDK-X11, JSON-GLib, GLib/GIO, AT-SPI2, libevdev, libudev, X11, Xi, XTest and XFixes. The deb declares these libraries alongside Electron's dependencies. On Ubuntu 24.04 their runtime packages include `libgtk-3-0t64`, `libjson-glib-1.0-0`, `libglib2.0-0t64`, `libatspi2.0-0t64`, `libevdev2`, `libudev1`, `libxi6`, `libxtst6`, `libx11-6` and `libxfixes3`. Ubuntu provides the historical GTK, GLib and AT-SPI package names used in deb dependencies through those t64 packages. Both workers also require the system C/C++ runtime. Artifacts built on Ubuntu 24.04 do not establish compatibility with older distributions.

AppImage users need those runtime libraries installed. The AppImage carries the helper and workers, not a private replacement for the desktop's GTK, accessibility stack or GPU driver. The package verification driver prints the actual library origins with loader overrides removed. An unresolved dependency is a failure.

Acceleration additionally needs the Vulkan loader and a compatible host ICD driver. The CPU worker has no Vulkan loader dependency. Missing acceleration can start the separate CPU worker once before READY. A failure after READY never replays inference or PCM.

On GNOME Wayland, the helper uses GTK's X11 selection provider through the compositor's XWayland clipboard bridge. Both a working XWayland `DISPLAY` and the bridge are required for Copy and manual native Wayland paste. A Wayland socket alone does not prove the bridge. No-XWayland compositors are outside this initial runtime guarantee.

Physical Wayland shortcuts require read access to keyboard devices on the active seat. A system administrator must configure that access through the host's existing policy. Group changes require a new login. Codevo reports missing access; it never invokes sudo, chmod, a privileged daemon or EVIOCGRAB. Linux regular shortcuts do not require a fabricated macOS Accessibility grant.

## Shortcuts and delivery

Record a shortcut in the existing settings. Re-record it after switching between X11 and Wayland. Stored X11 codes use `0x10000 + native X11 code`; evdev codes use `0x20000 + Linux input code`. Untagged Mac codes and codes from the other session are refused. Linux modifier states are converted into the existing Shift/Control/Alt/Meta wire masks. Left and right modifier identities remain separate. Ctrl+Super+V is reserved for the last transcript.

Select one paste shortcut for the target application: Ctrl+V, Ctrl+Shift+V or Shift+Insert. Codevo never tries all variants. Ctrl+V and Ctrl+Shift+V use CLIPBOARD. Shift+Insert uses PRIMARY and retains CLIPBOARD recovery text. Direct typing on Linux copies the text and explains the limitation.

X11 delivery requires the captured nonnull window and process, a positively editable AT-SPI field, known clear protection, released modifiers and an active unlocked session. The native helper rechecks authorization before paste and submit. Unknown terminal password state, inaccessible fields, protected input and unknown focus do not authorize injection. A posting acknowledgment alone does not prove target consumption. Ctrl+Shift+V is not a paste binding in a plain GTK Entry; test native posting in a compatible editable widget and manual paste in a terminal.

Clipboard transactions distinguish Copy from paste and restore from leave. Copy touches CLIPBOARD only, even after Shift+Insert. The native owner snapshots every touched selection before restore-policy paste can write. Incomplete preparation preserves the original data and leaves the transcript recoverable. Explicit Copy does not require a restorable old snapshot. Original ownership is checked before writing, and current offers are checked immediately before posting. XFixes owner generations and timestamps distinguish later equal-text copies. After the settling delay, ownership and generation must still belong to the operation. Later owners win even when their text equals the transcript. A forced rollback is also conditional.

## Release packages

Every release tag publishes the AppImage and the deb for x64 and arm64 to the GitHub release, together with `latest-linux.yml`, `latest-linux-arm64.yml` and `SHA256SUMS-linux-<arch>`; `release.yml` builds them through the reusable `release-linux.yml` and verifies the manifests before and after the upload (see `docs/operations/release.md`, Linux). The AppImage updates in the app from those manifests. The deb is a manual package: the app only reads the manifest version, shows the newer version and links to the release page.

## Build without publishing

Install build dependencies through your normal development or CI setup. The required development packages are CMake, Ninja, pkg-config, GTK3, JSON-GLib, AT-SPI2, libevdev, libudev, X11/Xi/XTest/XFixes, Vulkan headers, glslc and SPIRV-Headers. The Linux release workflow (`.github/workflows/release-linux.yml`) lists their Ubuntu package names.

Run from the checkout with the existing machine limits:

```sh
buildq scripts/release/build-native.sh x64
buildq pnpm --filter @codevo-whisper/desktop build
buildq pnpm --dir apps/desktop exec electron-builder --linux AppImage deb --x64 --publish never
```

Use arm64 on an actual arm64 builder. This task's x64 execution does not prove native arm64 behavior. `CW_TRANSCRIBE_WORK` and `CW_NATIVE_BUILD_DIR` select build directories. `CW_GLSLC_EXECUTABLE`, `CW_VULKAN_INCLUDE_DIR`, `CW_VULKAN_LIBRARY` and CMake's standard `CMAKE_PREFIX_PATH` support an extracted development toolchain. They do not become runtime dependencies. The helper omits build RUNPATHs. Both worker variants use the same pinned upstream revision and current product worker source. The Vulkan shader compiler wrapper serializes upstream shader subprocesses; outer builds remain capped at six.

The staged directory is `apps/desktop/resources/bin/<arch>` and contains `codevo-input-helper`, `transcribe-cli`, `cw-stt-worker` and `cw-stt-worker-vulkan`.

## Verify native and package behavior

Use an isolated writable evidence directory through TMPDIR and retain command arguments, source/binary hashes and nonzero exits.

```sh
python3 native/linux-helper/test/protocol.py apps/desktop/resources/bin/x64/codevo-input-helper
python3 native/linux-helper/test/desktop.py --session x11 --helper apps/desktop/resources/bin/x64/codevo-input-helper --controlled-only
xvfb-run -a python3 native/linux-helper/test/selections.py apps/desktop/resources/bin/x64/codevo-input-helper
xvfb-run -a python3 native/linux-helper/test/input-lifecycle.py apps/desktop/resources/bin/x64/codevo-input-helper --unmanaged
python3 native/linux-helper/test/evdev.py apps/desktop/resources/bin/x64/codevo-input-helper
python3 scripts/test/linux-package.py --artifact /absolute/application.AppImage --cpu-without-vulkan --model /absolute/catalog-model.gguf --pcm /absolute/fixture.pcm
```

The evdev driver creates one uniquely named temporary uinput keyboard and restricts the helper to its exact node. It does not alter device permissions or read other keyboards. Its default mode proves repeat, recording, modifier and unplug behavior. The optional `--read-error` case uses `test/evdev-read-error-fixture.c` through LD_PRELOAD to check retirement, same-node reopening without removal, cancellation and neutral rearm at the external libevdev boundary. It does not prove kernel overflow or physical device recovery. Compile with `cc -shared -fPIC $(pkg-config --cflags libevdev) -o /absolute/evdev-read-error.so native/linux-helper/test/evdev-read-error-fixture.c -ldl`.

The optional `--synthetic-sync` case requires the separately compiled `test/evdev-sync-fixture.c` through LD_PRELOAD. That case simulates libevdev's sync return at the external library boundary. It does not prove a kernel overflow. The attempted uinput SYN_DROPPED event is filtered on this host and its failed experiment remains separate evidence.

The package driver extracts without installation, checks ELF architecture and executable staging, rejects absolute build search paths and inspects sanitized dependency origins. Its absent-loader fixture contains the packaged worker binaries and CPU dependency closure, with no libvulkan file. It runs explicit CPU and automatic startup fallback with two real model replies each, from an arbitrary working directory. Disabled ICD discovery is a different test.

## Use a secure Electron launcher

Development and verification require working user namespaces or a correctly installed sandbox helper/profile. Never pass a sandbox-disable flag or change the host to force a test through. The existing Playwright launcher explicitly enables Chromium sandboxing.

`scripts/test/secure-linux.sh EVIDENCE_DIRECTORY COMMAND...` uses the preexisting bwrap profile, a read-only host root and a writable evidence directory. It creates a short proc-fd TMPDIR alias inside the namespace. This is a declared test fixture. It drops supplementary input groups and can emit read-only dconf/NSS warnings. It proves neither general installed-app security nor physical evdev access for the packaged app. The X11 overlay test records EWMH management, stacking over normal/fullscreen targets, focus/type retention, actual Copy outcome, no sandbox-disable switch and renderer kernel sandbox state.

## Verify an actual GNOME Wayland login

Complete independent X11, native, model and package work first. Preserve the clean pushed head, binaries and evidence. Then log into a real local GNOME Wayland session. Keep XWayland, the clipboard bridge, physical input access, native GTK and GNOME Terminal available. Use a secure installation/launcher that also retains the app's legitimate input access for full physical app dictation. The bwrap fixture alone cannot establish that combined prerequisite.

Run:

```sh
scripts/test/verify-wayland.sh /absolute/evidence-directory
```

The driver refuses X11 and environment-only Wayland overrides. It verifies the active local session, Wayland socket, XWayland connection, built artifacts, actual evdev capability and a native GdkWayland GTK target. Follow its physical recording, held/released gesture, screen lock/unlock, replay and manual Unicode paste instructions. It verifies unknown-focus no-injection and the actual native GTK clipboard bridge. The second command drives the product's reduced native Wayland window and interactive Copy with secure Chromium settings. Geometry, topmost and focus retention are deliberately not asserted as compositor guarantees.

Also record these real-session outcomes before acceptance:

1. In a controlled native GNOME Terminal running a line reader, use explicit Copy then manually paste Unicode through Ctrl+Shift+V. Confirm the reader receives the expected bytes. Keep automatic delivery copy-only for that terminal.
2. In the native GTK password field, exercise automatic completion and Ctrl+Super+V. Confirm the field receives no automatic text and the transcript remains recoverable.
3. With the actual catalog model ready, start and finish a physical dictation gesture using a real microphone. Confirm the selected language, capture failure/permission handling, final transcript, manual paste and explicit Copy. Do not pass Chromium fake-media switches for this step.
4. Exercise the reduced window's Copy and settings actions. If the compositor activates it, confirm that target uncertainty still prevents injection. Check keyboard focus and accessible names in the existing settings and permission UI.
5. Record lock/suspend, release loss and reconnect outcomes separately. The controlled uinput and external-library sync fixtures do not substitute for actual physical-session observations.

The X11 file-backed microphone test downloads and activates a catalog model through existing IPC, then drives the real helper, capture and resident engine. It is actual catalog/model/capture evidence, while physical microphone and real Wayland remain separate verification.
