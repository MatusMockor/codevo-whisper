# Codevo Whisper server - setup

The server runs as a Docker Compose project with two services, or natively on a Linux desktop with the Codevo Whisper app installed (see [Native (systemd, without Docker)](#native-systemd-without-docker)):

- `gateway` - the encrypted WebSocket endpoint for paired devices, the admin socket and the `codevo-whisper` CLI. It is the only service that publishes a port, on `127.0.0.1:8787` by default.
- `stt` - the transcribe.cpp sidecar (Parakeet Ultra F16, Vulkan on one GPU render node, plus Canary 1B v2 and VoxLingua107 language ID for "Výber jazykov"). Internal only, reachable from the gateway as `http://stt:8001`. The model volume is writable for the sidecar so that authorized devices can download and remove the optional transcription models (see [Server models from the desktop app](#server-models-from-the-desktop-app)); the initial provisioning still runs as the separate `stt-provision` service.

The gateway stores only its static key (`/data/server-key.json`, mode 0600) and the device registry (`/data/devices.json`) in the `cw-data` volume. Audio and transcripts stay in memory. Core dumps are disabled in both containers (`ulimits.core: 0`) and logs contain only device ids, sizes, durations and error codes. Swap is outside the app's control; disable it or encrypt it if that matters to you.

## Requirements

- Linux host with Docker Engine and the Compose plugin.
- A GPU with Vulkan support exposed as `/dev/dri` (tested target: AMD RX 7800 XT with Mesa RADV). `STT_BACKEND=cpu` works without a GPU, but slower. On a host without `/dev/dri`, remove the `devices` and `group_add` entries of the `stt` service in `compose.yaml`, because the container does not start without the device.

Only the render node of the GPU that should run the model is passed into the container. Find it by the GPU's PCI address:

```bash
lspci | grep -i -E 'vga|display'   # e.g. 03:00.0 ... Navi 32 [Radeon RX 7700 XT / 7800 XT]
ls -l /dev/dri/by-path/            # pci-0000:03:00.0-render -> ../renderD128
```

Set `STT_RENDER_DEVICE` to that node (default `/dev/dri/renderD128`). It appears in the container as `/dev/dri/renderD128`, so Vulkan sees only that GPU, even on hosts with an integrated GPU next to the discrete one.
- About 2.5 GB of disk for the three models (1.3 GB without "Výber jazykov"), 3.1 GB more for the provisioned Whisper Large v3, and about 1 GB for the images. Every optional model downloaded from the desktop app needs its size plus 1 GiB of free space in the `cw-models` volume when the download starts (Parakeet Ultra Q8 0.74 GB, Whisper Large v3 Q8 1.67 GB, Whisper Large v3 Turbo F16 1.63 GB, Whisper Large v3 Turbo Q8 0.89 GB).

## Install

```bash
git clone <repository> ~/Developer/codevo-whisper
cd ~/Developer/codevo-whisper
cp infrastructure/compose/.env.example infrastructure/compose/.env
getent group render
```

Set in `infrastructure/compose/.env`:

| Variable | Meaning |
|---|---|
| `CW_BIND` | Host address the gateway port is published on. `127.0.0.1` (default) or the WireGuard/Tailscale address. Never `0.0.0.0` on a machine reachable from the internet. |
| `CW_PORT` | Host port, default `8787`. |
| `CW_PUBLIC_ENDPOINT` | The `ws://` or `wss://` URL devices use; it is written into pairing tokens. |
| `RENDER_GID` | Numeric GID of the host `render` group (from `getent group render`), so the non-root `stt` user can open the render node. `VIDEO_GID` is no longer needed. |
| `STT_RENDER_DEVICE` | Host render node of the GPU, default `/dev/dri/renderD128` (see above). |
| `STT_MEM_LIMIT`, `STT_CPUS`, `GATEWAY_MEM_LIMIT`, `GATEWAY_CPUS` | Container limits, defaults `8g`, `4`, `512m`, `2` (`8g` leaves room for Parakeet, Canary, the language ID and Whisper Large v3 resident at once). Both services also run with `cap_drop: [ALL]`, `no-new-privileges`, a read-only root filesystem, PID limits (stt 128, gateway 64) and `nofile` limits (stt 1024, gateway 4096). |
| `STT_BACKEND`, `STT_THREADS` | `vulkan` (default) or `cpu`, and the engine thread count. |
| `STT_MODEL_PATH`, `STT_CONDITIONED_MODEL_PATH`, `STT_LID_MODEL_PATH`, `STT_WHISPER_MODEL_PATH` | Model files in the `cw-models` volume, defaults `/models/parakeet-ultra-F16.gguf`, `/models/canary-1b-v2-Q8_0.gguf`, `/models/lang-id-voxlingua107-ecapa-Q8_0.gguf` and `/models/whisper-large-v3-F16.gguf`. Provisioning and the sidecar read the same values. |
| `STT_MODELS_DIR` | Directory in the `cw-models` volume where downloaded models are stored, default `/models`. The default model and Whisper Large v3 keep their own paths above. |
| `STT_MODEL_DOWNLOADS` | `enabled` (default) or `disabled`. The kill switch for downloading and removing models from devices; `disabled` refuses both and the desktop app shows the catalog read-only. |
| `STT_MAX_RESIDENT_MODELS` | How many optional models (everything except the default Parakeet Ultra) may stay loaded at once, 1 to 8, default `2`. When another one has to load, the least recently used idle one is unloaded first; a model is never unloaded while it transcribes. |
| `STT_LID_BACKEND` | Backend of the language ID model, `cpu` (default; about 12 ms per 2 s of audio), `vulkan` or `metal`. |
| `STT_ENGINE` | `worker` (default) keeps the model loaded in one resident `cw-stt-worker` process; `cli` starts `transcribe-cli` for every call (the phase 2 behaviour; measured on the RX 7800 XT at about 550 ms against 120 ms per call for 12 s of audio). |
| `CW_TRUSTED_PROXY_HEADER` | Empty by default. Set it only when every connection arrives through a proxy you control that sets this header, for example `CF-Connecting-IP` behind Cloudflare Tunnel. See "Limits behind tunnels and proxies". |

## Build, provision, start

```bash
COMPOSE="docker compose -f infrastructure/compose/compose.yaml"
$COMPOSE build
$COMPOSE --profile provision run --rm stt-provision
$COMPOSE up -d
$COMPOSE ps
ss -ltn | grep 8787
```

Provisioning downloads four pinned models into the `cw-models` volume:

| Role | Repository and revision | File | Size | SHA-256 |
|---|---|---|---|---|
| Transcription | `handy-computer/parakeet-ultra-gguf` @ `a1539be1b849ea7463b88343e5277b373d0c4ea9` | `parakeet-ultra-F16.gguf` | 1,256,724,448 B | `cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d` |
| Language-conditioned transcription | `handy-computer/canary-1b-v2-gguf` @ `692af661b140183b60e44f55ad03c59e1e77d078` | `canary-1b-v2-Q8_0.gguf` | 1,144,290,016 B | `224f83d1bc487b3303b495a7d6874912fdece93de19d1a04b550829c30a5d289` |
| Language ID | `handy-computer/lang-id-voxlingua107-ecapa-gguf` @ `e59f0f3847e77723b7d58447ef9456fa0c7e9436` | `lang-id-voxlingua107-ecapa-Q8_0.gguf` | 26,693,632 B | `063e6cb0af3d53085fc7d68356dfde5ecee2ffa7bc79855f7e4ff930081bfe3a` |
| Selectable transcription (Whisper, MIT) | `handy-computer/whisper-large-v3-gguf` @ `274ad1d1cf680b7ee53cc70f78461394cd3a344b` | `whisper-large-v3-F16.gguf` | 3,107,236,640 B | `e633ab1d74b0e98f4f57daedaee34291297dbbf01389bda3d890766600c1c584` |

It prints `Optional models add 4.28 GB` first, then one line per file. Each file is written to a `.download` file, hashed while streaming and renamed only when the hash matches. Running it again verifies the existing files (`Model already present and verified`). The `stt` service never downloads at startup. It exits with `model_missing` if the transcription model is absent. Without Canary or the language ID model it starts anyway, logs `language_models_missing` and serves only automatic dictation. At startup it logs `selectable_models` with the optional models whose files are present (`installed`), the kill switch (`downloads`) and the residency limit (`maxResident`); a missing optional model is reported as unavailable, devices then use Parakeet or download it (see below). Parakeet is loaded at startup; an optional model such as Whisper is loaded when the first dictation that selects it starts (a few seconds; that dictation waits for it, the other devices keep dictating meanwhile) and stays resident until the residency limit (`STT_MAX_RESIDENT_MODELS`) needs its place.

### Verify "Výber jazykov"

The gateway asks the sidecar for its capabilities at startup, every 30 s and on every device connection. Check the answer from inside the gateway container (the slim image has no `curl`, so the command uses Node.js `fetch`):

```bash
$COMPOSE exec gateway node -e "fetch('http://stt:8001/capabilities').then((r) => r.text()).then(console.log)"
```

With all three models it prints the 25 languages and the model names:

```json
{"languages":["bg","cs","da","de","el","en","es","et","fi","fr","hr","hu","it","lt","lv","mt","nl","pl","pt","ro","ru","sk","sl","sv","uk"],"models":{"transcription":"Parakeet Ultra (F16)","conditioned":"Canary 1B v2 (Q8)","languageId":"VoxLingua107 (rozpoznanie jazyka)"},"transcriptionModels":[{"id":"parakeet-ultra","name":"Parakeet Ultra (F16)","available":true,"default":true},{"id":"whisper-large-v3","name":"Whisper Large v3 (F16)","available":true,"default":false}]}
```

`transcriptionModels` lists every model of the pinned catalog that a device can pick for its dictations (desktop apps need a gateway of version 0.5.0 or newer). `"available":false` means the file is missing: download it from an authorized desktop app, or run the provisioning again and restart the sidecar with `$COMPOSE restart stt` (files added outside the sidecar are picked up only at startup; downloads and removals through the sidecar take effect at once). The gateway picks up the new list on its next capability refresh (every 30 s, or on the next device connection), so no gateway restart is needed.

`"languages":[]` means the language models are missing or not loaded: run the provisioning again and check `$COMPOSE logs stt` for `language_models_missing` or `language_models_warmup_failed`. A `404` means the sidecar image predates language sets; rebuild it. Desktop apps see the same list and models in the server card, and restricted dictation needs a gateway of version 0.3.0 or newer (`codevo-whisper status` prints the version). Older desktops and the mobile app keep working unchanged.

## Pair a device

```bash
$COMPOSE exec gateway codevo-whisper pair
```

The command opens a pairing window (10 minutes, one device), prints the `cw1:` token and a terminal QR code. Paste the token into the app (or the dev client, see below). When the device connects the command prints the device name, the device key fingerprint and the connection fingerprint and asks `Spárovať toto zariadenie? [y/N]`. Compare the connection fingerprint with the one the device shows before answering `y`.

The token works for one device only. The window closes when a device is paired or rejected, when it expires, when the `pair` command is interrupted, after 20 failed attempts in total, and when the gateway restarts. An address with 5 failed attempts is refused for the rest of the window. A failed attempt (wrong token secret, replayed handshake) does not close the window on its own.

### In the desktop app

Open **Prepis** in the app (section **Vlastný server**), copy the pair command if you need it (on Linux the app shows `codevo-whisper-server pair`), paste the whole `cw1:` line into **Párovací token** and press **Spárovať**. The app shows the connection fingerprint; answer `y` on the server only if it matches. The device name is the computer name. The device key, the pinned server key and the endpoint are stored encrypted with the system key store (macOS Keychain through Electron `safeStorage`); on Linux the app refuses to pair when only the `basic_text` backend is available.

Then choose the order in **Prepis > Trasa prepisu**: "Lokálne", "Server", "Server, potom lokálne" or "Lokálne, potom server". The engine is picked when a dictation starts and never changes during it. If the connection drops during a dictation, the app reconnects once and sends the whole recording again (up to 2 minutes of audio).

## Manage devices

```bash
$COMPOSE exec gateway codevo-whisper devices
$COMPOSE exec gateway codevo-whisper revoke <id>
$COMPOSE exec gateway codevo-whisper grant-models <id>
$COMPOSE exec gateway codevo-whisper revoke-models <id>
$COMPOSE exec gateway codevo-whisper status
```

`revoke` takes effect immediately: open sessions of the device are closed with `revoked`, its queued and running transcriptions are cancelled and its buffered audio is dropped. "Odpojiť" in the app only pauses the connection and keeps the pairing; "Pripojiť" resumes it without pairing again. "Zrušiť párovanie" deletes the pairing on the device only; use `revoke` to remove it from the server.

## Server models from the desktop app

Gateway 0.6.0 and newer offer a pinned catalog of transcription models, all from Hugging Face `handy-computer` at fixed revisions and verified by size and SHA-256:

| Id | Name | Repository @ revision | File | Size | SHA-256 |
|---|---|---|---|---|---|
| `parakeet-ultra` | Parakeet Ultra (F16), default, cannot be removed | `parakeet-ultra-gguf` @ `a1539be1b849ea7463b88343e5277b373d0c4ea9` | `parakeet-ultra-F16.gguf` | 1,256,724,448 B | `cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d` |
| `parakeet-ultra-q8` | Parakeet Ultra (Q8) | `parakeet-ultra-gguf` @ `a1539be1b849ea7463b88343e5277b373d0c4ea9` | `parakeet-ultra-Q8_0.gguf` | 740,363,168 B | `007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59` |
| `whisper-large-v3` | Whisper Large v3 (F16) | `whisper-large-v3-gguf` @ `274ad1d1cf680b7ee53cc70f78461394cd3a344b` | `whisper-large-v3-F16.gguf` | 3,107,236,640 B | `e633ab1d74b0e98f4f57daedaee34291297dbbf01389bda3d890766600c1c584` |
| `whisper-large-v3-q8` | Whisper Large v3 (Q8) | `whisper-large-v3-gguf` @ `274ad1d1cf680b7ee53cc70f78461394cd3a344b` | `whisper-large-v3-Q8_0.gguf` | 1,668,741,440 B | `2fa1a5f179f8a511a53e2108db270aa4af3ce08cd976af4180e2854666bb4ba3` |
| `whisper-large-v3-turbo` | Whisper Large v3 Turbo (F16) | `whisper-large-v3-turbo-gguf` @ `18ada752005f5fddef499256f9a458d0b37a203a` | `whisper-large-v3-turbo-F16.gguf` | 1,625,935,488 B | `c8506ddfa3d4eb9279170d722a75422db00dbdbd7618531bbb81926e0598eb8f` |
| `whisper-large-v3-turbo-q8` | Whisper Large v3 Turbo (Q8) | `whisper-large-v3-turbo-gguf` @ `18ada752005f5fddef499256f9a458d0b37a203a` | `whisper-large-v3-turbo-Q8_0.gguf` | 886,381,728 B | `257aa7ec9121c22c167d5e2c49e3e76b4ba0e6e27ebc13074eba0a80f8190220` |

Parakeet models dictate through Canary and the language ID like the default; Whisper models transcribe directly. Every paired device may choose a model; only devices you authorize may download or remove one:

```bash
$COMPOSE exec gateway codevo-whisper grant-models <id>    # on Linux native: codevo-whisper-server grant-models <id>
$COMPOSE exec gateway codevo-whisper revoke-models <id>
```

The permission is stored with the device in `devices.json` (`"manageModels": true`, absent means not allowed) and takes effect at once, also for open connections. `devices` shows it as `správa modelov: povolená` or `nepovolená`. Revoking the device removes it too.

How downloads work:

- The `stt` sidecar downloads the file itself, so it needs outbound HTTPS to `huggingface.co`. Only the pinned files above can be downloaded; devices never send a URL.
- One download at a time for the whole server; a second one is refused as busy. Before it starts, the sidecar checks that the volume has the model size plus 1 GiB free (`statfs`).
- The file is written to `<target>.partial` in the models directory, checked for its exact size and SHA-256, flushed, renamed atomically and the directory is synced. A failed, mismatched or cancelled download deletes the partial file; leftovers from a crash are deleted at the next start. A failed download stays visible as failed until the next attempt or restart.
- A finished download is available at once, no restart. A removal unloads the model first and then deletes the file; the default model can never be removed and a model that is transcribing at that moment is refused.
- Logs: `model_download_started`, `model_downloaded`, `model_download_failed` (with the reason), `model_download_cancelled`.
- `STT_MODEL_DOWNLOADS=disabled` in `.env` (then `$COMPOSE up -d stt`) turns downloading and removing off for every device; the files already in the volume stay usable.
- Memory: with the default limit, Parakeet, Canary, the language ID and two optional models can be loaded at once. Two large F16 models together can exceed the default `STT_MEM_LIMIT=8g`; lower `STT_MAX_RESIDENT_MODELS` to `1` or raise the limit.

`stt-provision` still downloads only the default model, the two language models and Whisper Large v3.

## Rotate the server key

```bash
$COMPOSE exec gateway codevo-whisper rotate-key
```

Use it when the server key may have leaked or the `cw-data` volume was copied somewhere it should not be. It asks `Všetky zariadenia sa budú musieť znova spárovať. Pokračovať? [y/N]`, generates a new key, removes all devices and closes all sessions with `server_key_changed`. Devices never accept a changed server key on their own; each one must be paired again. If the key file is lost, start the gateway with an empty `cw-data` volume and pair all devices again.

## Logs

```bash
$COMPOSE logs -f gateway
$COMPOSE logs -f stt
```

The gateway logs one JSON line per dictation: `deviceId`, `audioSeconds`, `finals`, `partials`, `durationMs`, `result` (`ok`, `cancelled` or an error code) and `routes`, the number of final segments per routing decision of a dictation with languages (for example `{"conditioned":5,"verbatim-unsure":1}`, empty for automatic dictation). The sidecar logs only startup (`listening`, `engine_ready` or `engine_warmup_failed`, `language_models_missing`, `language_models_ready` or `language_models_warmup_failed`, `selectable_models`), model downloads (`model_download_*`, `model_downloaded`) and engine error status codes. Neither logs audio, text or the language of a segment.

## Native (systemd, without Docker)

On a Linux machine with the Codevo Whisper desktop app, the gateway and the sidecar can run as two systemd user services that reuse the app's STT worker and model. No Docker, no GPU passthrough.

Requirements: Node.js 24+ and pnpm on `PATH`, the desktop app installed (`/opt/Codevo Whisper`) and Parakeet Ultra downloaded in it (`~/.config/Codevo Whisper/models/parakeet-ultra-q8.gguf`). For "Výber jazykov" also download Canary 1B v2 and the language ID model in the app (`canary-1b-v2-q8.gguf` and `langid-voxlingua107-q8.gguf` in the same folder). Without them the script prints `Výber jazykov nebude dostupný, stiahnite Canary 1B v2 a rozpoznávanie jazyka v aplikácii`, installs anyway, and the server offers only automatic dictation.

```bash
CW_PUBLIC_ENDPOINT=wss://<host>.ts.net scripts/install-server-service.sh
```

The script builds `apps/server` and `apps/stt`, copies both bundles, the STT worker and the two language models (to `models/`) to `~/.local/share/codevo-whisper-server/`, so the checkout and the desktop package can be removed or replaced afterwards (deb or AppImage), and writes:

- `~/.config/codevo-whisper-server/env` (mode 0600): the settings. Override any of `CW_PUBLIC_ENDPOINT` (default `ws://127.0.0.1:8787`), `CW_BIND`, `CW_PORT`, `STT_PORT`, `STT_BACKEND`, `STT_THREADS`, `STT_WORKER_BINARY`, `STT_MODEL_PATH`, `STT_CONDITIONED_MODEL_PATH`, `STT_LID_MODEL_PATH` in the environment of the install command. The two language model paths name the files to copy; the env file then points to the copies. A language model path given explicitly that does not exist stops the install before anything changes (`Súbor modelu zadaný v STT_CONDITIONED_MODEL_PATH neexistuje: ...`); only the default files of the desktop app are optional. A later run keeps the values of the previous one unless overridden.
- `~/.local/state/codevo-whisper-server/` (mode 0700): server key, device registry and admin socket. If it has no key yet, the pairings from `~/.local/state/codevo-phone-server/data` are copied over.
- `codevo-whisper-stt.service` and `codevo-whisper-gateway.service` in `~/.config/systemd/user/`, enabled and restarted.
- `~/.local/bin/codevo-whisper-server`, the `codevo-whisper` CLI bound to the service's admin socket.

Later runs keep the copied worker and language models; to replace one, pass its variable again (`STT_WORKER_BINARY`, `STT_CONDITIONED_MODEL_PATH` or `STT_LID_MODEL_PATH`). Language models downloaded in the app after the first run are picked up by the next run. A worker can also come from an AppImage ( `./Codevo*.AppImage --appimage-extract 'resources/bin/x64/cw-stt-worker-vulkan'`). Run it again after pulling changes or switching the Node.js version; the units use the absolute `node` path found at install time. User services stop at logout; `loginctl enable-linger` keeps them running.

```bash
codevo-whisper-server pair
codevo-whisper-server devices
codevo-whisper-server revoke <id>
codevo-whisper-server grant-models <id>
codevo-whisper-server status
journalctl --user -u codevo-whisper-gateway -f
journalctl --user -u codevo-whisper-stt -f
curl -s http://127.0.0.1:8001/capabilities
```

Model downloads from the desktop app write to `STT_MODELS_DIR` (default `/models`, which does not exist on a native install) and Whisper Large v3 to `STT_WHISPER_MODEL_PATH`. The install script does not set them yet; to use downloads natively, add `STT_MODELS_DIR=$HOME/.local/share/codevo-whisper-server/models` and `STT_WHISPER_MODEL_PATH=$HOME/.local/share/codevo-whisper-server/models/whisper-large-v3-F16.gguf` (expanded paths) to `~/.config/codevo-whisper-server/env` and run `systemctl --user restart codevo-whisper-stt`. Without them a download is refused as `stt_unavailable`.

Tailscale: keep `CW_BIND=127.0.0.1`, run `tailscale serve --bg 8787` and install with `CW_PUBLIC_ENDPOINT=wss://<host>.ts.net` (the MagicDNS name of the machine). Pair devices only after the endpoint is set; tokens carry it.

Uninstall:

```bash
systemctl --user disable --now codevo-whisper-gateway.service codevo-whisper-stt.service
rm ~/.config/systemd/user/codevo-whisper-{gateway,stt}.service ~/.local/bin/codevo-whisper-server
rm -r ~/.local/share/codevo-whisper-server ~/.config/codevo-whisper-server
systemctl --user daemon-reload
```

`~/.local/state/codevo-whisper-server` holds the server key and the paired devices; delete it too only if every device should pair again.

## Reaching the gateway from other networks

The application layer is end-to-end encrypted (Noise IK with the pinned server key), so the transport can be anything that forwards a WebSocket. Set `CW_PUBLIC_ENDPOINT` to what devices will dial and restart the gateway before pairing.

- **SSH tunnel** (testing): `ssh -N -L 8787:127.0.0.1:8787 user@server`, `CW_PUBLIC_ENDPOINT=ws://127.0.0.1:8787`.
- **WireGuard / Tailscale**: `CW_BIND=<VPN address of the server>`, `CW_PUBLIC_ENDPOINT=ws://<VPN address>:8787`. Only VPN peers can reach the port.
- **Cloudflare Tunnel**: keep `CW_BIND=127.0.0.1`, point a tunnel ingress rule at `http://127.0.0.1:8787` (WebSockets are forwarded), `CW_PUBLIC_ENDPOINT=wss://whisper.example.com`. Cloudflare sees only ciphertext plus metadata (addresses, timing, sizes).

### Limits behind tunnels and proxies

Before authentication the gateway allows 4 pending connections per client address and 64 in total. Each must finish the handshake within 5 seconds. After `hello` a device may hold 4 sessions.

The per-address limit relies on the source address. Behind an SSH tunnel, Cloudflare Tunnel or Docker's loopback port proxy, every connection appears to come from the same address, so the per-address limit becomes a global one. In that case anyone who can reach the tunnel can hold the pending slots and briefly lock out real devices. They still cannot authenticate, and every slot is released after 5 seconds.

- **WireGuard or Tailscale (recommended):** only your peers can reach the port, and the source addresses are real.
- **Cloudflare Tunnel:** put Cloudflare Access in front of the hostname, so unauthenticated visitors never reach the gateway. Then set `CW_TRUSTED_PROXY_HEADER=CF-Connecting-IP`. The per-address limits then apply to the address Cloudflare reports, and the TCP-level limit falls back to the global 64.
- **Direct exposure:** only set `CW_TRUSTED_PROXY_HEADER` when clients cannot bypass the proxy, otherwise anyone can forge the header.

## Dev client

`tools/dev-client` is a command-line client that exercises the whole path. Its identity (device key pair, pinned server key, endpoint) lives in `~/.config/codevo-whisper-dev/identity.json` with mode 0600.

```bash
pnpm --filter dev-client start pair "<token>" --name "MacBook dev"
pnpm --filter dev-client start transcribe sample.wav --language sk
pnpm --filter dev-client start transcribe sample.wav --language sk --live
```

Without `--live` the client sends the first 120 s of the file at once and the rest in real time (the gateway accepts at most a 180 s burst and then 1.25 x real time per device). With `--live` it asks for live partials (Živý text), sends 100 ms frames in real time and prints every partial (`~ [segment rRevision] text`) and final (`= [segment] text`) before the whole text. The WAV file must be PCM16 mono 16 kHz. A relative path is resolved against the directory you run `pnpm` from. If the server key changes, the client refuses to overwrite the pinned key; delete the identity file and pair again.

## Overené

2026-10-25, branch `phase-2-protocol-server`.

Local, on the Mac (Docker Desktop, arm64):

- `docker build -f apps/stt/Dockerfile -t codevo-whisper-stt:dev .` succeeded (transcribe.cpp `8facde6` built with Vulkan, statically linked, `ldd` check passed). The container runs as `node`, `transcribe-cli --help` works, and without a model the service exits with `model_missing`.
- `docker build -f apps/server/Dockerfile -t codevo-whisper-gateway:dev .` succeeded. In the container `/data` and `/run/codevo-whisper` are `drwx------ node`, `server-key.json` and `admin.sock` are mode 0600.
- Pairing through `docker exec -i ... codevo-whisper pair` and `pnpm --filter dev-client start pair`: both sides showed the same connection fingerprint, `y` paired the device and the identity file was written with mode 0600.
- `transcribe` without a running STT returned `stt_unavailable`; after `codevo-whisper revoke <id>` the next `transcribe` returned `unknown_device`.
- `docker compose -f infrastructure/compose/compose.yaml config` resolves with the example `.env` (gateway published on `127.0.0.1:8787` only, `stt` without ports, `/dev/dri` and the two group IDs, `ulimits.core: 0`).

Home server (`codex@192.168.1.110`, Ubuntu x86_64, RX 7800 XT), commit `38375d1`, deployed as compose project `codevo-whisper` in `~/Developer/codevo-whisper` from a git bundle of the branch. Other containers (aivora-*, pa-*, context-review-*) were not touched and kept running.

1. `.env` from the example with `VIDEO_GID=44`, `RENDER_GID=990`, `CW_PUBLIC_ENDPOINT=ws://127.0.0.1:8787`.
2. `docker compose ... build` succeeded (gateway 335 MB, stt 794 MB). `run --rm stt node dist/provision.js` downloaded and verified the model; a second run printed `Model already present and verified`. After `up -d`, `docker compose ps` showed both services `healthy`, the stt service logged `backend: vulkan`, and `ss -ltn` showed only `127.0.0.1:8787`. `ulimit -c` is 0 in both containers. `/data` and `/run/codevo-whisper` are `drwx------ node`, and `server-key.json`, `devices.json` and `admin.sock` are mode 0600.
3. SSH tunnel `ssh -N -L 8787:127.0.0.1:8787 codex@192.168.1.110`. `codevo-whisper pair` on the server and `dev-client pair` on the Mac showed the same device fingerprint (`E255 EA96 ...`) and connection fingerprint (`1D8F F424 ...`). After `y` the device was paired as `e255ea96`.
4. `dev-client transcribe sample.wav --language sk` returned exactly `Ahoj, toto je skúška prepisu slovenskej reči na grafickej karte. Potrebujem skontrolovať náš editor a potom odoslať zmenu.` The gateway logged `audioSeconds 6.7, chunks 1, durationMs 587, result ok`, and the client wall time was 0.9 s including the tunnel.
5. `codevo-whisper revoke e255ea96`, then the same `transcribe` failed with `Chyba: unknown_device`.

Redeployed at commit `63162f0`, after the pairing secret was changed to 32 bytes used directly as the Noise psk. The 43-character secret token paired (connection fingerprints matched), the sample transcript was again exact, and after `revoke` the device list was empty and `transcribe` returned `unknown_device`.

Redeployed at commit `8d5a779` after the final review fixes. Both services `healthy`, both containers have a read-only root filesystem with a size-limited `/tmp` tmpfs (stt 64 MB, gateway 16 MB), and only `127.0.0.1:8787` is published. Pairing (connection fingerprints matched), the exact Slovak transcript (gateway 604 ms for 6.7 s of audio) and `unknown_device` after `revoke` were repeated.

The stack was left running on the server, with no paired devices. Stop it with `docker compose -f infrastructure/compose/compose.yaml down`. Add `-v` to also delete the key, the registry and the model.
