#!/usr/bin/env bash

mac_app_path() {
  local output="$1" arch="$2"
  case "$arch" in
    arm64) echo "$output/mac-arm64/Codevo Whisper.app" ;;
    x64) echo "$output/mac/Codevo Whisper.app" ;;
    *) echo "unsupported arch: $arch" >&2; return 1 ;;
  esac
}

mac_release_dir() {
  local kind="$1" arch="$2" desktop
  desktop="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps/desktop" && pwd)"
  echo "$desktop/release/$kind/$arch"
}
