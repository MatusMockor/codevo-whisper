#!/usr/bin/env bash
set -euo pipefail
unset ELECTRON_RUN_AS_NODE
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/node_modules/electron/dist/Electron.app"
[ -d "$APP" ] || node "$ROOT/node_modules/electron/install.js"
open -n "$APP" --args "$ROOT" "$@"
echo "Launched via LaunchServices (TCC responsible app: Electron, com.github.Electron)."
echo "Log: $HOME/Library/Logs/CodevoWhisperSpike/macos-input.jsonl"
echo "Stop: pnpm stop"
