#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ARCH="${ARCH:-arm64}"
BACKEND="${BACKEND:-metal}"
RUNS="${RUNS:-5}"
BIN="${BIN:-$HERE/build/$ARCH/bin/transcribe-cli}"
MODEL="${MODEL:-$HERE/parakeet-ultra-F16.gguf}"
WAV="$HERE/sample.wav"
OUT="$HERE/out.txt"
LAUNCH=()

if [[ ! -x "$BIN" ]]; then
  echo "missing binary: $BIN (run build.sh $ARCH)" >&2
  exit 1
fi

if [[ ! -f "$MODEL" ]]; then
  echo "missing model: $MODEL" >&2
  exit 1
fi

if [[ ! -f "$WAV" ]]; then
  echo "missing sample: $WAV" >&2
  exit 1
fi

if [[ "$ARCH" == "x86_64" ]]; then
  LAUNCH=(arch -x86_64)
fi

TIMES=()
for i in $(seq 1 "$RUNS"); do
  rm -f "$OUT"
  START=$(perl -MTime::HiRes=time -e 'printf "%.6f", time')
  ${LAUNCH[@]+"${LAUNCH[@]}"} "$BIN" --model "$MODEL" --backend "$BACKEND" --language sk --threads 4 --timestamps none --quiet --output "$OUT" "$WAV"
  END=$(perl -MTime::HiRes=time -e 'printf "%.6f", time')
  T=$(perl -e "printf '%.3f', $END - $START")
  TIMES+=("$T")
  echo "run $i: ${T}s"
done

MEDIAN=$(printf '%s\n' "${TIMES[@]}" | sort -n | awk '{a[NR]=$1} END {print (NR%2==1) ? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2}')
echo "arch=$ARCH backend=$BACKEND runs=$RUNS median=${MEDIAN}s"
echo "transcript:"
cat "$OUT"
echo
