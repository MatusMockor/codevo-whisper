#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: scripts/release/publish-github-release.sh <version> <feed-dir>}"
feed="${2:?usage: scripts/release/publish-github-release.sh <version> <feed-dir>}"
: "${GH_TOKEN:?GH_TOKEN must be set}"
: "${GH_REPO:?GH_REPO must be set}"
: "${BUILD_SHA:?BUILD_SHA must be set}"
here="$(cd "$(dirname "$0")" && pwd)"
tag="v$version"
manifests=(latest-mac.yml latest-linux.yml latest-linux-arm64.yml)
checksums=(SHA256SUMS-linux-x64 SHA256SUMS-linux-arm64)

verify_feed_dir() {
  local name
  for name in "${manifests[@]}"; do
    node "$here/verify-feed.ts" "$1/$name" "$version"
  done
  for name in "${checksums[@]}"; do
    node "$here/verify-checksums.ts" "$1/$name"
  done
}

tag_commit="$(gh api "repos/$GH_REPO/commits/$tag" --jq .sha)"
[ "$tag_commit" = "$BUILD_SHA" ] || { echo "tag $tag points to $tag_commit, the build is $BUILD_SHA" >&2; exit 1; }

verify_feed_dir "$feed"

if gh release view "$tag" >/dev/null 2>&1; then
  echo "release $tag already exists, delete the draft or bump the version" >&2
  exit 1
fi

prerelease=()
if [[ "$version" == *-* ]]; then
  prerelease=(--prerelease)
fi

gh release create "$tag" --verify-tag --draft ${prerelease[@]+"${prerelease[@]}"} --title "Codevo Whisper $version" --generate-notes "$feed"/*

recheck="$(mktemp -d)"
trap 'rm -rf "$recheck"' EXIT
gh release download "$tag" --dir "$recheck"
node "$here/verify-release-assets.ts" "$feed" "$recheck"
verify_feed_dir "$recheck"

gh release edit "$tag" --draft=false
echo "published $tag"
