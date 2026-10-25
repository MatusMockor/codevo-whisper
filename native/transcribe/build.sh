#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

REPO_URL="https://github.com/handy-computer/transcribe.cpp.git"
COMMIT="8facde6fcd8fb9caa585a5788ab450df6e8ec7db"

arch="${1:-$(uname -m)}"
case "$arch" in
  arm64) target="arm64" ;;
  x64 | x86_64) arch="x64"; target="x86_64" ;;
  *) echo "unsupported arch: $arch" >&2; exit 1 ;;
esac

work="$(pwd)/work"
src="$work/transcribe.cpp"
build="$work/build/$arch"
dest="$(cd ../.. && pwd)/apps/desktop/resources/bin/$arch"

if [[ ! -d "$src/.git" ]]; then
  mkdir -p "$src"
  git -C "$src" init --quiet
  git -C "$src" remote add origin "$REPO_URL"
fi

if [[ "$(git -C "$src" rev-parse --verify --quiet HEAD || true)" != "$COMMIT" ]]; then
  git -C "$src" fetch --quiet --depth 1 origin "$COMMIT"
  git -C "$src" checkout --quiet --force "$COMMIT"
fi

cmake -S "$src" -B "$build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="$target" \
  -DTRANSCRIBE_METAL=ON \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DTRANSCRIBE_BUILD_TESTS=OFF \
  -DGGML_NATIVE=OFF

cmake --build "$build" --target transcribe-cli

mkdir -p "$dest"
cp "$build/bin/transcribe-cli" "$dest/transcribe-cli.tmp"
mv -f "$dest/transcribe-cli.tmp" "$dest/transcribe-cli"
echo "built $dest/transcribe-cli"
