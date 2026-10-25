# Spike: transcribe.cpp on macOS (Metal)

Date: 2026-10-25. Plan: `docs/plans/2026-10-25-phase-0-spikes.md`, Task 3. Spec: section 7 (local mode).

## Verdict

- **macOS arm64: GO** for Parakeet Ultra F16 in local mode with the Metal backend. Transcript is exact, warm latency 0.16 s wall for 6.7 s of audio (about 120x realtime), signed hardened-runtime binary works with no entitlements.
- **macOS x64 (Intel): CONDITIONAL GO, CPU backend as the default.** The x86_64 binary builds and runs correctly under Rosetta with both Metal and CPU, transcript exact. Real Intel hardware was not available, so the Intel GPU / AMD GPU Metal path is unverified. Ship the x64 binary with the CPU backend as the default and Metal as opt-in until it is verified on a real Intel Mac. Do not fall back to whisper.cpp-only for Intel.

## Environment

| Item | Value |
|---|---|
| Machine | Apple M5 Pro (Apple Silicon), macOS 26.6.2 (25G83) |
| Toolchain | Xcode 27.1 (27A9275), AppleClang, CMake 4.4.4, Ninja 1.13.2 (Homebrew) |
| Rosetta | installed, used via `arch -x86_64` |
| Upstream | `https://github.com/handy-computer/transcribe.cpp.git` @ `8facde6fcd8fb9caa585a5788ab450df6e8ec7db` (2026-10-25, "remove glossary from custom word prompt"), MIT license |
| Model | `parakeet-ultra-F16.gguf`, HF `handy-computer/parakeet-ultra-gguf` @ `a1539be1b849ea7463b88343e5277b373d0c4ea9`, 1,256,724,448 bytes, license cc-by-4.0 |
| Model SHA-256 | `cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d` - verified with `shasum -a 256`, matches the pin |
| Sample | `sample.wav` from the home server, 16 kHz mono Int16, 6.71 s |

## Build flags (exact)

Upstream names (from `CMakeLists.txt` and `CMakePresets.json` preset `wheel-macos-metal` at the pinned commit):

- Metal option is `TRANSCRIBE_METAL` (default ON only when `CMAKE_SYSTEM_PROCESSOR` matches arm64; it is mirrored onto `GGML_METAL`).
- Shader embedding is `GGML_METAL_EMBED_LIBRARY` (defaults to `GGML_METAL`; upstream sets it ON for its macOS artifacts so there are no sidecar `.metal` files).
- CLI backend values: `auto`, `cpu`, `cpu_accel`, `metal`, `vulkan`, `cuda`, `rocm`. `--backend metal` is correct as written in the plan.
- `TRANSCRIBE_BUILD_EXAMPLES` must stay ON (default) for the `transcribe-cli` target.

Command used by `spikes/transcribe-macos/build.sh <arch>`:

```bash
cmake -S transcribe.cpp -B build/<arch> -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=<arm64|x86_64> \
  -DTRANSCRIBE_METAL=ON \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DTRANSCRIBE_BUILD_TESTS=OFF \
  -DGGML_NATIVE=OFF
cmake --build build/<arch> --target transcribe-cli
```

Notes:

- Output path is `build/<arch>/bin/transcribe-cli` (one build dir per arch, not `build/bin` as in the plan).
- On an Intel CI runner `TRANSCRIBE_METAL` would default to OFF, so `-DTRANSCRIBE_METAL=ON` must be explicit for x64. On an arm64 host with `CMAKE_OSX_ARCHITECTURES=x86_64` it already defaults ON (detection uses the host processor), but keep it explicit.
- x86_64 with `GGML_NATIVE=OFF` and no cross toolchain file enables `-msse4.2 -mf16c -mfma -mbmi2 -mavx -mavx2` (ggml `INS_ENB` path). All Intel Macs that can run current macOS / Electron have AVX2, so this is fine. If a SIGILL is ever reported, upstream has `-DTRANSCRIBE_X86_CONSERVATIVE=ON`.
- Build is static (libtranscribe + ggml linked in). Dependencies are system frameworks only: Accelerate, Foundation, Metal, MetalKit, CoreFoundation, libobjc, libc++, libSystem. No dylibs to bundle.
- Build time on M5 Pro: about 11 s wall (arm64) and 8 s (x86_64) with Ninja.

## Binary size

| Binary | Size |
|---|---|
| arm64, unsigned (linker ad-hoc) | 9,132,800 B (8.7 MiB) |
| arm64, stripped | 8,573,416 B (8.2 MiB) |
| arm64, Developer ID signed | 9,098,000 B (8.7 MiB) |
| x86_64, unsigned | 10,040,944 B (9.6 MiB) |
| x86_64, stripped | 9,477,120 B (9.0 MiB) |
| x86_64, Developer ID signed | 10,137,856 B (9.7 MiB) |

## Latency

Command (`spikes/transcribe-macos/run.sh`, env `ARCH`, `BACKEND`, `BIN`, `RUNS`):

```bash
transcribe-cli --model parakeet-ultra-F16.gguf --backend <metal|cpu> --language sk --threads 4 --timestamps none --quiet --output out.txt sample.wav
```

Wall time is the whole process (exec, model mmap, Metal init, mel, encode, decode, write). Model file was in the page cache for all runs (a truly cold read after reboot was not measured; `purge` needs sudo).

| Arch | Backend | Runs (s) | Median wall | CLI timings (warm, typical) |
|---|---|---|---|---|
| arm64 | metal | 0.166, 0.158, 0.175, 0.157, 0.164 | **0.164 s** | load 77 ms, encode 36 ms, decode 20 ms (~119x RT) |
| arm64 | cpu | 0.375, 0.357, 0.360, 0.359, 0.353 | **0.359 s** | load 106 ms, encode 200 ms, decode 20 ms (~30x RT) |
| arm64 signed | metal | 3.615, 0.164, 0.164, 0.156, 0.159 | **0.164 s** | run 1: load 2771 ms, encode 386 ms |
| x86_64 Rosetta | metal | 5.151, 0.297, 0.294, 0.304, 0.292 | **0.297 s** | run 1: load 3622 ms; warm: load 160 ms, encode 59 ms, decode 26 ms (~77x RT) |
| x86_64 Rosetta | cpu | 1.777, 1.767, 1.778, 1.793, 1.828 | **1.778 s** | load 266 ms, encode 1390 ms, decode 27 ms (~5x RT) |
| x86_64 Rosetta signed | metal | 3.840, 0.292, 0.290 | 0.292 s (3 runs) | run 1: load 2556 ms |
| x86_64 Rosetta signed | cpu | 1.728, 1.736, 1.733 | 1.733 s (3 runs) | - |

Peak memory (arm64, Metal, `/usr/bin/time -l`): max RSS 267 MB, peak footprint 254 MB. Weights (1198 MiB) are memory-mapped into a shared Metal buffer, not copied.

### First-run cost per new binary

The first Metal run of a binary with a new code identity costs about 2.5-3.6 s extra, almost all in `load` (Metal pipeline compilation into the system shader cache). It is cached afterwards. A byte-identical copy of an already-run binary at a new path did not pay it (0.46 s first run), a re-signed binary did (3.6 s). CPU backend has no such cost. Consequence for the app: the first dictation after install or after every update is slow unless the app does a warmup run (for example a short silent buffer) after an update. Add this to spec section 7.

## Accuracy

Every run on every arch/backend/signing combination produced exactly:

```
Ahoj, toto je skúška prepisu slovenskej reči na grafickej karte. Potrebujem skontrolovať náš editor a potom odoslať zmenu.
```

This matches the expected transcript character for character, including punctuation and diacritics.

## Signing (Step 4)

```bash
codesign --force --options runtime --timestamp \
  --identifier app.codevo.whisper.transcribe-cli \
  -s "Developer ID Application: codevo s.r.o. (U574W69TH6)" transcribe-cli-signed
```

- Succeeded without any keychain prompt. Timestamp server reachable.
- `codesign --verify --strict`: valid, satisfies its Designated Requirement. Flags `0x10000(runtime)`, TeamIdentifier `U574W69TH6`, chain Developer ID Application -> Developer ID Certification Authority -> Apple Root CA.
- Runs under hardened runtime with Metal and CPU, arm64 natively and x86_64 under Rosetta. **No entitlements needed** (no JIT, no unsigned executable memory, no library validation exception, since there are no dylibs).
- Without `--identifier`, codesign uses the file name as identifier; set an explicit one (`app.codevo.whisper.transcribe-cli`) when it is signed inside the app.
- `spctl -a -t exec` rejects the standalone binary with `source=Unnotarized Developer ID`. Expected: it will be notarized as part of the app bundle (Task 4), not standalone.

## Recommendation for spec section 7

- Parakeet Ultra F16 via transcribe.cpp is the default local engine on macOS arm64 with `--backend metal`. Latency is low enough that local mode can use the same rolling re-transcription approach as the server.
- macOS x64: ship the x86_64 build (same flags, explicit `-DTRANSCRIBE_METAL=ON`). Default to `--backend cpu` on Intel until Metal is verified on a real Intel Mac with Intel iGPU / AMD dGPU (those GPUs lack `simdgroup matrix mul`, which ggml Metal uses on Apple GPUs, so performance and correctness there are unknown). Rosetta CPU numbers (about 5x realtime, 1.8 s for 6.7 s) are only indicative of the code path, not of Intel performance. If real Intel CPU turns out below roughly 2x realtime, offer the small whisper model as the Intel default and keep Parakeet as an option.
- Two separate thin binaries (arm64, x86_64) are fine; a universal binary would be about 19 MiB and is not needed since the app ships per-arch builds.
- Bundle the binary signed with hardened runtime and no entitlements; sign it with an explicit identifier.
- Do a warmup transcription after install/update to pay the Metal shader compilation outside of a real dictation.
- The model is 1.26 GB; catalog entry values are confirmed: revision `a1539be1b849ea7463b88343e5277b373d0c4ea9`, size 1,256,724,448 B, SHA-256 `cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d`, license cc-by-4.0 (attribution required). transcribe.cpp is MIT.

## Not verified

- Real Intel Mac hardware (Metal on Intel/AMD GPUs and native x86 CPU speed).
- Cold model read after reboot (page cache empty).
- Notarization of the binary (covered by Task 4 inside the app bundle).
- Longer audio and rolling re-transcription on device.

## Files

- `spikes/transcribe-macos/build.sh` - clone + pin + configure + build, `build.sh arm64|x86_64`.
- `spikes/transcribe-macos/run.sh` - 5 timed runs and median, env `ARCH`, `BACKEND`, `BIN`, `RUNS`, `MODEL`.
- `spikes/transcribe-macos/.gitignore` - `*.gguf`, `build/`, `transcribe.cpp/`, `out.txt`, `sample.wav`.
- Raw logs (ignored, local only): `spikes/transcribe-macos/build/*.log`.
