#!/usr/bin/env bash
set -euo pipefail
run=${1:?usage: secure-linux.sh RUN_DIRECTORY COMMAND...}
shift
run=$(realpath "$run")
mkdir -p "$run/tmp"
export TMPDIR="$run/tmp"
bwrap --unshare-user --unshare-ipc --unshare-uts --ro-bind / / --bind "$run" "$run" --proc /proc --dev-bind /dev /dev --die-with-parent --new-session bash -c 'exec 9<"$TMPDIR"; export TMPDIR="/proc/$$/fd/9"; "$@"' secure-linux "$@"
