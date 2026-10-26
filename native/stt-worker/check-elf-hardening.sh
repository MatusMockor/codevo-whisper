#!/usr/bin/env bash
set -euo pipefail

status=0
for binary in "$@"; do
  header="$(readelf -hW "$binary")"
  dynamic="$(readelf -dW "$binary")"
  program="$(readelf -lW "$binary")"
  fortified="$(readelf -sW --dyn-syms "$binary" | grep -c '__[a-z_]*_chk' || true)"
  echo "== $binary"
  grep -E '^ +Type:' <<<"$header"
  grep -E '\((FLAGS|FLAGS_1)\)' <<<"$dynamic" || true
  grep -E 'GNU_RELRO|GNU_STACK' <<<"$program"
  echo "fortified symbols: $fortified"
  if ! grep -Eq 'Type: +DYN' <<<"$header"; then
    echo "FAIL: not a position independent executable"
    status=1
  fi
  if ! grep -Eq 'BIND_NOW|FLAGS_1.*NOW' <<<"$dynamic"; then
    echo "FAIL: no BIND_NOW"
    status=1
  fi
  if ! grep -q 'GNU_RELRO' <<<"$program"; then
    echo "FAIL: no GNU_RELRO segment"
    status=1
  fi
  if grep 'GNU_STACK' <<<"$program" | grep -q 'RWE'; then
    echo "FAIL: executable stack"
    status=1
  fi
  if [[ "$fortified" -eq 0 ]]; then
    echo "FAIL: no fortified libc calls"
    status=1
  fi
done
exit "$status"
