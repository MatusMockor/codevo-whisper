#!/usr/bin/env bash
set -euo pipefail

: "${EVENT_NAME:?EVENT_NAME must be set}"
: "${REF_NAME:?REF_NAME must be set}"
: "${BUILD_SHA:?BUILD_SHA must be set}"
main_ref="refs/remotes/origin/main"

git rev-parse --verify --quiet "$main_ref^{commit}" >/dev/null || { echo "origin/main is not available, check out with fetch-depth 0" >&2; exit 1; }

if [ "$EVENT_NAME" = "push" ]; then
  tag_commit="$(git rev-parse --verify --quiet "refs/tags/$REF_NAME^{commit}")" || { echo "tag $REF_NAME not found" >&2; exit 1; }
  [ "$tag_commit" = "$BUILD_SHA" ] || { echo "tag $REF_NAME does not point to $BUILD_SHA" >&2; exit 1; }
fi

if [ "$EVENT_NAME" != "push" ] && [ "$REF_NAME" != "main" ]; then
  echo "manual release runs are allowed only from main, not $REF_NAME" >&2
  exit 1
fi

git merge-base --is-ancestor "$BUILD_SHA" "$main_ref" || { echo "$BUILD_SHA is not on main" >&2; exit 1; }
echo "build commit $BUILD_SHA verified for $EVENT_NAME $REF_NAME"
