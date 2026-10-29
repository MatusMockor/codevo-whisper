#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
arch=${1:-$(uname -m)}
case "$arch" in x86_64|x64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 64;; esac
build=${CW_NATIVE_BUILD_DIR:-"$root/native/linux-helper/build/$arch"}
cmake -S "$root/native/linux-helper" -B "$build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$build" --parallel 6
stage="$root/apps/desktop/resources/bin/$arch"
mkdir -p "$stage"
install -m755 "$build/codevo-input-helper" "$stage/codevo-input-helper"
