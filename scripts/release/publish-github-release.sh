#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: scripts/release/publish-github-release.sh <version> <feed-dir>}"
feed="${2:?usage: scripts/release/publish-github-release.sh <version> <feed-dir>}"
: "${GH_TOKEN:?GH_TOKEN must be set}"
: "${GH_REPO:?GH_REPO must be set}"
: "${BUILD_SHA:?BUILD_SHA must be set}"
here="$(cd "$(dirname "$0")" && pwd)"
tag="v$version"

tag_commit="$(gh api "repos/$GH_REPO/commits/$tag" --jq .sha)"
[ "$tag_commit" = "$BUILD_SHA" ] || { echo "tag $tag points to $tag_commit, the build is $BUILD_SHA" >&2; exit 1; }

node "$here/verify-feed.ts" "$feed/latest-mac.yml" "$version"

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
node "$here/verify-feed.ts" "$recheck/latest-mac.yml" "$version"

gh release edit "$tag" --draft=false
echo "published $tag"
