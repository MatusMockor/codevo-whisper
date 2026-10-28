#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

arch="${1:-$(uname -m)}"
case "$arch" in
  arm64) target="arm64" ;;
  x64 | x86_64) arch="x64"; target="x86_64" ;;
  *) echo "unsupported arch: $arch" >&2; exit 1 ;;
esac

mkdir -p "build/$arch"
swiftc -O -swift-version 6 -target "$target-apple-macos13.0" \
  -framework AppKit -framework Carbon -framework IOKit -framework ApplicationServices -framework CoreAudio \
  Sources/*.swift -o "build/$arch/codevo-input-helper"
echo "built $(pwd)/build/$arch/codevo-input-helper"
