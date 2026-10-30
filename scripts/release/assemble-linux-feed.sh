#!/usr/bin/env bash
set -euo pipefail

artifacts="${1:?usage: scripts/release/assemble-linux-feed.sh <artifacts-dir> <feed-dir> <version>}"
feed="${2:?usage: scripts/release/assemble-linux-feed.sh <artifacts-dir> <feed-dir> <version>}"
version="${3:?usage: scripts/release/assemble-linux-feed.sh <artifacts-dir> <feed-dir> <version>}"
here="$(cd "$(dirname "$0")" && pwd)"

manifest_name() {
  if [ "$1" = "x64" ]; then
    echo "latest-linux.yml"
    return
  fi
  echo "latest-linux-$1.yml"
}

copy_new() {
  local target
  target="$feed/$(basename "$1")"
  [ ! -e "$target" ] || { echo "$target already exists, refusing to overwrite it" >&2; exit 1; }
  cp "$1" "$target"
}

mkdir -p "$feed"
manifests=()
checksums=()
for arch in x64 arm64; do
  dir="$artifacts/linux-$arch"
  manifest="$(manifest_name "$arch")"
  for required in "$manifest" "SHA256SUMS-linux-$arch"; do
    [ -f "$dir/$required" ] || { echo "missing $dir/$required" >&2; exit 1; }
  done
  listed="$(node "$here/manifest-urls.ts" "$dir/$manifest")"
  packages=("$dir"/*.AppImage "$dir"/*.deb)
  for package in "${packages[@]}"; do
    [ -f "$package" ] || { echo "missing $package" >&2; exit 1; }
    name="$(basename "$package")"
    grep -qxF -- "$name" <<<"$listed" || { echo "$name is in linux-$arch but not listed in $manifest" >&2; exit 1; }
    awk -v name="$name" '$2 == name || $2 == "*" name { found = 1 } END { exit !found }' "$dir/SHA256SUMS-linux-$arch" || { echo "$name is not listed in SHA256SUMS-linux-$arch" >&2; exit 1; }
    copy_new "$package"
  done
  copy_new "$dir/$manifest"
  copy_new "$dir/SHA256SUMS-linux-$arch"
  manifests+=("$feed/$manifest")
  checksums+=("$feed/SHA256SUMS-linux-$arch")
done

for manifest in "${manifests[@]}"; do
  node "$here/verify-feed.ts" "$manifest" "$version"
done
node "$here/verify-checksums.ts" "${checksums[@]}"
