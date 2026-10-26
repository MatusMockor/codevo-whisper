#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

seconds="${FUZZ_SECONDS:-600}"
image="cw-stt-worker-fuzz:local"
docker build -q -f fuzz/Dockerfile -t "$image" . > /dev/null
docker run --rm --network none --read-only --tmpfs /tmp:size=64m --tmpfs /corpus:size=256m \
  --memory 2g --cpus 1 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges:true \
  --entrypoint sh "$image" -c "cp /fuzz/seeds/* /corpus/ && /fuzz/request-fuzzer -max_total_time=$seconds -rss_limit_mb=1536 -print_final_stats=1 /corpus"
docker image rm -f "$image" > /dev/null
