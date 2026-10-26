#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

REPO_URL="https://github.com/handy-computer/transcribe.cpp.git"
COMMIT="8facde6fcd8fb9caa585a5788ab450df6e8ec7db"

work="$(pwd)/work"
src="$work/transcribe.cpp"
build="$work/build"

if [[ ! -d "$src/.git" ]]; then
  mkdir -p "$src"
  git -C "$src" init --quiet
  git -C "$src" remote add origin "$REPO_URL"
fi

if [[ "$(git -C "$src" rev-parse --verify --quiet HEAD || true)" != "$COMMIT" ]]; then
  git -C "$src" fetch --quiet --depth 1 origin "$COMMIT"
  git -C "$src" checkout --quiet --force "$COMMIT"
fi
test "$(git -C "$src" rev-parse HEAD)" = "$COMMIT"

cmake -S "$src" -B "$build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PROJECT_transcribe_INCLUDE="$(pwd)/stt-worker.cmake" \
  -DCMAKE_C_FLAGS_RELEASE="-O2 -DNDEBUG" \
  -DCMAKE_CXX_FLAGS_RELEASE="-O2 -DNDEBUG" \
  -DCMAKE_C_FLAGS="-fstack-protector-strong" \
  -DCMAKE_CXX_FLAGS="-fstack-protector-strong" \
  -DTRANSCRIBE_METAL=ON \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DTRANSCRIBE_BUILD_TESTS=OFF \
  -DGGML_NATIVE=OFF
cmake --build "$build" --target cw-stt-worker transcribe-cli
echo "$build/bin/cw-stt-worker"
