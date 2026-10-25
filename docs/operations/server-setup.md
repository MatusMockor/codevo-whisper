# Codevo Whisper server - setup

The server is a Docker Compose project with two services:

- `gateway` - the encrypted WebSocket endpoint for paired devices, the admin socket and the `codevo-whisper` CLI. It is the only service that publishes a port, on `127.0.0.1:8787` by default.
- `stt` - the transcribe.cpp sidecar (Parakeet Ultra F16, Vulkan on `/dev/dri`). Internal only, reachable from the gateway as `http://stt:8001`.

The gateway stores only its static key (`/data/server-key.json`, mode 0600) and the device registry (`/data/devices.json`) in the `cw-data` volume. Audio and transcripts stay in memory. Core dumps are disabled in both containers (`ulimits.core: 0`) and logs contain only sizes, durations and error codes. Swap is outside the app's control; disable it or encrypt it if that matters to you.

## Requirements

- Linux host with Docker Engine and the Compose plugin.
- A GPU with Vulkan support exposed as `/dev/dri` (tested target: AMD RX 7800 XT with Mesa RADV). `STT_BACKEND=cpu` works without a GPU, but slower.
- About 1.3 GB of disk for the model and about 1 GB for the images.

## Install

```bash
git clone <repository> ~/Developer/codevo-whisper
cd ~/Developer/codevo-whisper
cp infrastructure/compose/.env.example infrastructure/compose/.env
getent group video render
```

Set in `infrastructure/compose/.env`:

| Variable | Meaning |
|---|---|
| `CW_BIND` | Host address the gateway port is published on. `127.0.0.1` (default) or the WireGuard/Tailscale address. Never `0.0.0.0` on a machine reachable from the internet. |
| `CW_PORT` | Host port, default `8787`. |
| `CW_PUBLIC_ENDPOINT` | The `ws://` or `wss://` URL devices use; it is written into pairing tokens. |
| `VIDEO_GID`, `RENDER_GID` | Numeric GIDs of the host `video` and `render` groups (from `getent group video render`), so the non-root `stt` user can open `/dev/dri`. |
| `STT_BACKEND`, `STT_THREADS` | `vulkan` (default) or `cpu`, and the engine thread count. |

## Build, provision, start

```bash
COMPOSE="docker compose -f infrastructure/compose/compose.yaml"
$COMPOSE build
$COMPOSE run --rm stt node dist/provision.js
$COMPOSE up -d
$COMPOSE ps
ss -ltn | grep 8787
```

Provisioning downloads the pinned model (`handy-computer/parakeet-ultra-gguf` revision `a1539be1b849ea7463b88343e5277b373d0c4ea9`, SHA-256 `cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d`) into the `cw-models` volume. It writes to a `.download` file, hashes while streaming and renames only when the hash matches. Running it again verifies the existing file. The `stt` service never downloads at startup; it exits with `model_missing` if the model is absent.

## Pair a device

```bash
$COMPOSE exec gateway codevo-whisper pair
```

The command opens a pairing window (10 minutes, one device), prints the `cw1:` token and a terminal QR code. Paste the token into the app (or the dev client, see below). When the device connects the command prints the device name, the device key fingerprint and the connection fingerprint and asks `Spárovať toto zariadenie? [y/N]`. Compare the connection fingerprint with the one the device shows before answering `y`.

The token works for one device only. The window closes when a device is paired or rejected, when it expires, when the `pair` command is interrupted, after 20 failed attempts in total, and when the gateway restarts. An address with 5 failed attempts is refused for the rest of the window. A failed attempt (wrong token secret, replayed handshake) does not close the window on its own.

## Manage devices

```bash
$COMPOSE exec gateway codevo-whisper devices
$COMPOSE exec gateway codevo-whisper revoke <id>
$COMPOSE exec gateway codevo-whisper status
```

`revoke` takes effect immediately: open sessions of the device are closed with `revoked`, its queued and running transcriptions are cancelled and its buffered audio is dropped. "Odpojiť server" in the app only deletes the pairing on the device; use `revoke` to remove it from the server.

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

The gateway logs one JSON line per dictation: `deviceId`, `audioSeconds`, `chunks`, `durationMs` and `result` (`ok`, `cancelled` or an error code). The sidecar logs only startup and engine error status codes. Neither logs audio or text.

## Reaching the gateway from other networks

The application layer is end-to-end encrypted (Noise IK with the pinned server key), so the transport can be anything that forwards a WebSocket. Set `CW_PUBLIC_ENDPOINT` to what devices will dial and restart the gateway before pairing.

- **SSH tunnel** (testing): `ssh -N -L 8787:127.0.0.1:8787 user@server`, `CW_PUBLIC_ENDPOINT=ws://127.0.0.1:8787`.
- **WireGuard / Tailscale**: `CW_BIND=<VPN address of the server>`, `CW_PUBLIC_ENDPOINT=ws://<VPN address>:8787`. Only VPN peers can reach the port.
- **Cloudflare Tunnel**: keep `CW_BIND=127.0.0.1`, point a tunnel ingress rule at `http://127.0.0.1:8787` (WebSockets are forwarded), `CW_PUBLIC_ENDPOINT=wss://whisper.example.com`. Cloudflare sees only ciphertext plus metadata (addresses, timing, sizes).

## Dev client

`tools/dev-client` is a command-line client that exercises the whole path. Its identity (device key pair, pinned server key, endpoint) lives in `~/.config/codevo-whisper-dev/identity.json` with mode 0600.

```bash
pnpm --filter dev-client start pair "<token>" --name "MacBook dev"
pnpm --filter dev-client start transcribe sample.wav --language sk
```

The WAV file must be PCM16 mono 16 kHz. If the server key changes, the client refuses to overwrite the pinned key; delete the identity file and pair again.

## Overené

2026-10-25, branch `phase-2-protocol-server`.

Local, on the Mac (Docker Desktop, arm64):

- `docker build -f apps/stt/Dockerfile -t codevo-whisper-stt:dev .` succeeded (transcribe.cpp `8facde6` built with Vulkan, statically linked, `ldd` check passed). The container runs as `node`, `transcribe-cli --help` works, and without a model the service exits with `model_missing`.
- `docker build -f apps/server/Dockerfile -t codevo-whisper-gateway:dev .` succeeded. In the container `/data` and `/run/codevo-whisper` are `drwx------ node`, `server-key.json` and `admin.sock` are mode 0600.
- Pairing through `docker exec -i ... codevo-whisper pair` and `pnpm --filter dev-client start pair`: both sides showed the same connection fingerprint, `y` paired the device and the identity file was written with mode 0600.
- `transcribe` without a running STT returned `stt_unavailable`; after `codevo-whisper revoke <id>` the next `transcribe` returned `unknown_device`.
- `docker compose -f infrastructure/compose/compose.yaml config` resolves with the example `.env` (gateway published on `127.0.0.1:8787` only, `stt` without ports, `/dev/dri` and the two group IDs, `ulimits.core: 0`).

Home server (`codex@192.168.1.110`): not run. The host did not answer on the LAN during this session (SSH and ping timed out while the rest of the LAN responded), so steps 1-5 of the plan's smoke test (build on the server, provision, `ss -ltn`, pairing over the SSH tunnel, the Slovak sample transcript, revoke) are still open.
