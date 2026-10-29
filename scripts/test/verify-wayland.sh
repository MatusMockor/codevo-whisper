#!/usr/bin/env bash
set -euo pipefail
run=${1:?usage: verify-wayland.sh EVIDENCE_DIRECTORY}
root=$(cd "$(dirname "$0")/../.." && pwd)
case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;; *) exit 64;; esac
for name in codevo-input-helper transcribe-cli cw-stt-worker cw-stt-worker-vulkan; do
  test -x "$root/apps/desktop/resources/bin/$arch/$name"
done
python3 "$root/native/linux-helper/test/wayland.py" --helper "$root/apps/desktop/resources/bin/$arch/codevo-input-helper" --evidence "$run"
"$root/scripts/test/secure-linux.sh" "$run" pnpm --dir "$root/apps/desktop" exec playwright test e2e/linux-wayland.spec.ts --output "$run/reduced-overlay"
