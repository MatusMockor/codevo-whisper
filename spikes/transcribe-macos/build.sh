#!/usr/bin/env bash
set -euo pipefail

ARCH="${1:-arm64}"
REPO_URL="https://github.com/handy-computer/transcribe.cpp.git"
COMMIT="8facde6fcd8fb9caa585a5788ab450df6e8ec7db"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/transcribe.cpp"
BUILD="$HERE/build/$ARCH"

if [[ "$ARCH" != "arm64" && "$ARCH" != "x86_64" ]]; then
  echo "usage: $0 [arm64|x86_64]" >&2
  exit 2
fi

if [[ ! -d "$SRC/.git" ]]; then
  git clone "$REPO_URL" "$SRC"
fi

git -C "$SRC" fetch --quiet origin "$COMMIT" || true
git -C "$SRC" checkout --quiet "$COMMIT"

cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
  -DTRANSCRIBE_METAL=ON \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DTRANSCRIBE_BUILD_TESTS=OFF \
  -DGGML_NATIVE=OFF

cmake --build "$BUILD" --target transcribe-cli

BIN="$BUILD/bin/transcribe-cli"
file "$BIN"
ls -l "$BIN"
otool -L "$BIN"
