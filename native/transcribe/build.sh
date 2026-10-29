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

work="${CW_TRANSCRIBE_WORK:-$(pwd)/work}"
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

if [[ "$(uname -s)" == Linux ]]; then
  glslc="${CW_GLSLC_EXECUTABLE:-$(command -v glslc || true)}"
  if [[ -z "$glslc" ]]; then echo 'glslc is required for the Vulkan worker' >&2; exit 1; fi
  mkdir -p "$work"
  printf '#!/usr/bin/env bash\nexec flock %q %q "$@"\n' "$work/glslc.lock" "$glslc" > "$work/glslc-serial"
  chmod +x "$work/glslc-serial"
  for variant in cpu vulkan; do
    acceleration=OFF
    name=cw-stt-worker
    if [[ "$variant" == vulkan ]]; then acceleration=ON; name=cw-stt-worker-vulkan; fi
    build="$work/build/$arch-$variant"
    options=()
    if [[ -n "${CW_VULKAN_INCLUDE_DIR:-}" ]]; then options+=("-DVulkan_INCLUDE_DIR=$CW_VULKAN_INCLUDE_DIR"); fi
    if [[ -n "${CW_VULKAN_LIBRARY:-}" ]]; then options+=("-DVulkan_LIBRARY=$CW_VULKAN_LIBRARY"); fi
    cmake -S "$src" -B "$build" -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_PROJECT_transcribe_INCLUDE="$(cd ../stt-worker && pwd)/stt-worker.cmake" \
      -DTRANSCRIBE_BUILD_SHARED=OFF -DBUILD_SHARED_LIBS=OFF \
      -DTRANSCRIBE_BUILD_TESTS=OFF -DTRANSCRIBE_USE_SYSTEM_BLAS=OFF \
      -DTRANSCRIBE_X86_CONSERVATIVE=ON -DGGML_NATIVE=OFF -DGGML_CCACHE=OFF \
      -DTRANSCRIBE_METAL=OFF -DGGML_METAL=OFF -DTRANSCRIBE_VULKAN="$acceleration" \
      -DVulkan_GLSLC_EXECUTABLE="$work/glslc-serial" \
      -DCMAKE_C_FLAGS=-fstack-protector-strong -DCMAKE_CXX_FLAGS=-fstack-protector-strong "${options[@]}"
    cmake --build "$build" --target transcribe-cli cw-stt-worker --parallel 6
    mkdir -p "$dest"
    install -m755 "$build/bin/cw-stt-worker" "$dest/$name.tmp"
    mv -f "$dest/$name.tmp" "$dest/$name"
    if [[ "$variant" == cpu ]]; then
      install -m755 "$build/bin/transcribe-cli" "$dest/transcribe-cli.tmp"
      mv -f "$dest/transcribe-cli.tmp" "$dest/transcribe-cli"
    fi
  done
  exit 0
fi

cmake -S "$src" -B "$build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PROJECT_transcribe_INCLUDE="$(cd ../stt-worker && pwd)/stt-worker.cmake" \
  -DTRANSCRIBE_BUILD_SHARED=OFF \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_C_FLAGS="-fstack-protector-strong" \
  -DCMAKE_CXX_FLAGS="-fstack-protector-strong" \
  -DCMAKE_OSX_ARCHITECTURES="$target" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DTRANSCRIBE_METAL=ON \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DTRANSCRIBE_BUILD_TESTS=OFF \
  -DGGML_NATIVE=OFF

cmake --build "$build" --target transcribe-cli cw-stt-worker --parallel 6

mkdir -p "$dest"
for name in transcribe-cli cw-stt-worker; do
  cp "$build/bin/$name" "$dest/$name.tmp"
  mv -f "$dest/$name.tmp" "$dest/$name"
  echo "built $dest/$name"
done
