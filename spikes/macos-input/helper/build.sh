#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
swiftc -O -swift-version 6 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework Carbon -framework IOKit -framework ApplicationServices \
  Sources/*.swift -o build/codevo-input-helper
echo "built $(pwd)/build/codevo-input-helper"
