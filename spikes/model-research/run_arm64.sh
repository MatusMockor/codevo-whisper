#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PY:-$HOME/Library/Caches/codevo-whisper-research/venv/bin/python}"
WITH_AUTO=(parakeet-ultra-f16 parakeet-tdt-v3-q8 canary-1b-v2-q8 orukeet-q8 tc-whisper-turbo-q8 wc-large-v3 wc-turbo wc-medium-q5 wc-small wc-base)

needs_auto() {
  local id="$1"
  for candidate in "${WITH_AUTO[@]}"; do
    [[ "$candidate" == "$id" ]] && return 0
  done
  return 1
}

for id in "$@"; do
  "$PY" "$HERE/bench.py" "$id" --sets sample,sk,cs,en --modes warm,cold
  needs_auto "$id" || continue
  "$PY" "$HERE/bench.py" "$id" --sets sk,cs,en --modes auto
done
