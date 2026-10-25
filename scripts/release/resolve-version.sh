#!/usr/bin/env bash
set -euo pipefail

: "${EVENT_NAME:?EVENT_NAME must be set}"
version="${INPUT_VERSION:-}"
if [ "$EVENT_NAME" = "push" ]; then
  version="${REF_NAME#v}"
fi

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "invalid version: '$version'" >&2
  exit 1
fi
echo "version=$version" >>"${GITHUB_OUTPUT:-/dev/stdout}"
