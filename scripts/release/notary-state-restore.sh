#!/usr/bin/env bash
set -euo pipefail

arch="${1:?usage: scripts/release/notary-state-restore.sh <arm64|x64> <state-dir>}"
state="${2:?usage: scripts/release/notary-state-restore.sh <arm64|x64> <state-dir>}"
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/mac-app-path.sh"

mkdir -p "$state"
phase="$(node "$here/notary-state-cli.ts" phase "$state")"
echo "phase=$phase" >>"${GITHUB_OUTPUT:-/dev/stdout}"
echo "notary state for $arch: $phase" >&2

if [ "$phase" = "none" ]; then
  exit 0
fi

stage="$(mac_release_dir stage "$arch")"
app="$(mac_app_path "$stage" "$arch")"
rm -rf "$app"
mkdir -p "$(dirname "$app")"
ditto -x -k "$state/app.zip" "$(dirname "$app")"

if [ "$phase" = "dmg-submitted" ]; then
  dist="$(mac_release_dir dist "$arch")"
  rm -rf "$dist"
  mkdir -p "$dist"
  cp "$state/dist/"* "$dist/"
fi
