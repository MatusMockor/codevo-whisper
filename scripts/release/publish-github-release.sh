#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: scripts/release/publish-github-release.sh <version> <feed-dir>}"
feed="${2:?usage: scripts/release/publish-github-release.sh <version> <feed-dir>}"
: "${GH_TOKEN:?GH_TOKEN must be set}"
here="$(cd "$(dirname "$0")" && pwd)"
tag="v$version"
target="${GITHUB_SHA:-$(git rev-parse HEAD)}"

if gh release view "$tag" >/dev/null 2>&1; then
  echo "release $tag already exists, delete the draft or bump the version" >&2
  exit 1
fi

prerelease=()
if [[ "$version" == *-* ]]; then
  prerelease=(--prerelease)
fi

gh release create "$tag" --draft ${prerelease[@]+"${prerelease[@]}"} --title "Codevo Whisper $version" --generate-notes --target "$target" "$feed"/*

recheck="$(mktemp -d)"
trap 'rm -rf "$recheck"' EXIT
gh release download "$tag" --dir "$recheck"
node "$here/verify-feed.ts" "$recheck/latest-mac.yml"

gh release edit "$tag" --draft=false
echo "published $tag"
