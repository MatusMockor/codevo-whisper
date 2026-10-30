#!/usr/bin/env bash
set -euo pipefail

artifacts="${1:?usage: scripts/release/assemble-mac-feed.sh <artifacts-dir> <feed-dir> <version>}"
feed="${2:?usage: scripts/release/assemble-mac-feed.sh <artifacts-dir> <feed-dir> <version>}"
version="${3:?usage: scripts/release/assemble-mac-feed.sh <artifacts-dir> <feed-dir> <version>}"
here="$(cd "$(dirname "$0")" && pwd)"
manifests=()

for arch in x64 arm64; do
  dir="$artifacts/mac-$arch"
  [ -f "$dir/latest-mac.yml" ] || { echo "missing $dir/latest-mac.yml" >&2; exit 1; }
  manifests+=("$dir/latest-mac.yml")
done

mkdir -p "$feed"
find "$artifacts/mac-x64" "$artifacts/mac-arm64" -type f \( -name '*.zip' -o -name '*.dmg' -o -name '*.blockmap' \) -exec cp {} "$feed/" \;
node "$here/merge-latest-mac.ts" "$feed/latest-mac.yml" "${manifests[@]}"
node "$here/verify-feed.ts" "$feed/latest-mac.yml" "$version"
