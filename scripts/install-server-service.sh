#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$HOME/.local/share/codevo-whisper-server"
config_dir="$HOME/.config/codevo-whisper-server"
env_file="$config_dir/env"
state_dir="$HOME/.local/state/codevo-whisper-server"
old_data="$HOME/.local/state/codevo-phone-server/data"
unit_dir="$HOME/.config/systemd/user"
wrapper="$HOME/.local/bin/codevo-whisper-server"

fail() {
  echo "$1" >&2
  exit 1
}

model_source() {
  local explicit="$1" copy="$2" desktop="$3"
  if [[ -n "$explicit" ]]; then
    echo "$explicit"
    return
  fi
  if [[ -f "$copy" ]]; then
    echo "$copy"
    return
  fi
  echo "$desktop"
}

require_explicit_model() {
  local variable="$1" path="$2"
  [[ -z "$path" || -f "$path" ]] || fail "Súbor modelu zadaný v $variable neexistuje: $path"
}

copy_model() {
  local from="$1" to="$2"
  if [[ "$from" -ef "$to" || ! -f "$from" ]]; then
    return
  fi
  mkdir -p "$(dirname "$to")"
  cp "$from" "$to.tmp"
  chmod 644 "$to.tmp"
  mv "$to.tmp" "$to"
}

node="$(command -v node)" || fail "node not found on PATH; install Node.js 24 or newer"
"$node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || fail "Node.js 24 or newer is required, found $("$node" -v)"

explicit_conditioned="${STT_CONDITIONED_MODEL_PATH:-}"
explicit_lid="${STT_LID_MODEL_PATH:-}"

if [[ -f "$env_file" ]]; then
  while IFS='=' read -r key value; do
    [[ -n "${!key:-}" ]] || export "$key=${value//\"/}"
  done < "$env_file"
fi

worker_source="${STT_WORKER_BINARY:-/opt/Codevo Whisper/resources/bin/x64/cw-stt-worker-vulkan}"
worker="$app_dir/bin/cw-stt-worker"
desktop_models="$HOME/.config/Codevo Whisper/models"
conditioned_model="$app_dir/models/canary-1b-v2-Q8_0.gguf"
conditioned_source="$(model_source "$explicit_conditioned" "$conditioned_model" "$desktop_models/canary-1b-v2-q8.gguf")"
lid_model="$app_dir/models/lang-id-voxlingua107-ecapa-Q8_0.gguf"
lid_source="$(model_source "$explicit_lid" "$lid_model" "$desktop_models/langid-voxlingua107-q8.gguf")"

settings=(
  "STT_HOST=127.0.0.1"
  "STT_PORT=${STT_PORT:-8001}"
  "STT_BACKEND=${STT_BACKEND:-vulkan}"
  "STT_THREADS=${STT_THREADS:-4}"
  "STT_ENGINE=worker"
  "STT_WORKER_BINARY=$worker"
  "STT_MODEL_PATH=${STT_MODEL_PATH:-$desktop_models/parakeet-ultra-q8.gguf}"
  "STT_CONDITIONED_MODEL_PATH=$conditioned_model"
  "STT_LID_MODEL_PATH=$lid_model"
  "CW_BIND=${CW_BIND:-127.0.0.1}"
  "CW_PORT=${CW_PORT:-8787}"
  "CW_PUBLIC_ENDPOINT=${CW_PUBLIC_ENDPOINT:-ws://127.0.0.1:8787}"
  "CW_DATA_DIR=$state_dir/data"
  "CW_ADMIN_SOCKET=$state_dir/admin.sock"
  "CW_STT_URL=http://127.0.0.1:${STT_PORT:-8001}"
)
for setting in "${settings[@]}"; do
  export "$setting"
done

[[ -x "$worker_source" ]] || fail "STT worker not found: $worker_source. Install the Codevo Whisper desktop app or set STT_WORKER_BINARY."
[[ -f "$STT_MODEL_PATH" ]] || fail "model not found: $STT_MODEL_PATH. Download Parakeet Ultra in the desktop app or set STT_MODEL_PATH."
require_explicit_model STT_CONDITIONED_MODEL_PATH "$explicit_conditioned"
require_explicit_model STT_LID_MODEL_PATH "$explicit_lid"

pnpm --dir "$root" --filter @codevo-whisper/server --filter @codevo-whisper/stt build

mkdir -p "$app_dir"
rm -rf "$app_dir/server" "$app_dir/stt"
cp -r "$root/apps/server/dist" "$app_dir/server"
cp -r "$root/apps/stt/dist" "$app_dir/stt"
echo '{"type":"module"}' > "$app_dir/package.json"
if [[ ! "$worker_source" -ef "$worker" ]]; then
  mkdir -p "$app_dir/bin"
  rm -f "$worker"
  cp "$worker_source" "$worker"
  chmod 755 "$worker"
fi
copy_model "$conditioned_source" "$conditioned_model"
copy_model "$lid_source" "$lid_model"

mkdir -p -m 700 "$state_dir"
chmod 700 "$state_dir"
if [[ ! -f "$state_dir/data/server-key.json" && -d "$old_data" ]]; then
  mkdir -p -m 700 "$state_dir/data"
  cp -a "$old_data/." "$state_dir/data/"
  echo "copied pairings from $old_data"
fi

mkdir -p "$config_dir"
(umask 077 && printf '%s\n' "${settings[@]}" | sed 's/=\(.*\)/="\1"/' > "$env_file")
chmod 600 "$env_file"

hardening="NoNewPrivileges=yes
LockPersonality=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
SystemCallArchitectures=native
UMask=0077
LimitCORE=0"

mkdir -p "$unit_dir"
cat > "$unit_dir/codevo-whisper-stt.service" <<EOF
[Unit]
Description=Codevo Whisper speech-to-text sidecar

[Service]
EnvironmentFile=$env_file
ExecStart="$node" "$app_dir/stt/main.js"
Restart=on-failure
RestartSec=2
MemoryMax=4G
TasksMax=128
LimitNOFILE=1024
$hardening

[Install]
WantedBy=default.target
EOF

cat > "$unit_dir/codevo-whisper-gateway.service" <<EOF
[Unit]
Description=Codevo Whisper server gateway
Requires=codevo-whisper-stt.service
After=codevo-whisper-stt.service

[Service]
EnvironmentFile=$env_file
ExecStart="$node" "$app_dir/server/main.js"
Restart=on-failure
RestartSec=2
MemoryMax=512M
TasksMax=64
LimitNOFILE=4096
$hardening

[Install]
WantedBy=default.target
EOF

mkdir -p "$(dirname "$wrapper")"
cat > "$wrapper" <<EOF
#!/usr/bin/env bash
set -euo pipefail
set -a
. "$env_file"
set +a
exec "$node" "$app_dir/server/cli.js" "\$@"
EOF
chmod 755 "$wrapper"

systemctl --user daemon-reload
systemctl --user enable codevo-whisper-stt.service codevo-whisper-gateway.service
systemctl --user restart codevo-whisper-stt.service codevo-whisper-gateway.service
if [[ ! -f "$conditioned_model" || ! -f "$lid_model" ]]; then
  echo "Výber jazykov nebude dostupný, stiahnite Canary 1B v2 a rozpoznávanie jazyka v aplikácii" >&2
fi
echo "installed; pair a device with: $wrapper pair"
