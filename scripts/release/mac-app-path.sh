#!/usr/bin/env bash

mac_app_path() {
  local output="$1" arch="$2"
  case "$arch" in
    arm64) echo "$output/mac-arm64/Codevo Whisper.app" ;;
    x64) echo "$output/mac/Codevo Whisper.app" ;;
    *) echo "unsupported arch: $arch" >&2; return 1 ;;
  esac
}
