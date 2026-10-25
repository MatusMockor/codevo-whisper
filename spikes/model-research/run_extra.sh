#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PY:-$HOME/Library/Caches/codevo-whisper-research/venv/bin/python}"

for id in canary-1b-v2-q8 parakeet-ultra-q8 wc-turbo-q8; do
  "$PY" "$HERE/bench.py" "$id" --sets sk,cs,en --modes mismatch
done

"$PY" "$HERE/langid.py" metal

for id in parakeet-ultra-q8 canary-1b-v2-q4; do
  "$PY" "$HERE/bench.py" "$id" --sets sample,sk,en --modes warm,cold --backend cpu
done

for id in parakeet-ultra-q8 parakeet-ultra-q4 canary-1b-v2-q4; do
  "$PY" "$HERE/bench.py" "$id" --sets sample,sk,en --modes warm,cold --arch x86_64 --backend cpu
done
