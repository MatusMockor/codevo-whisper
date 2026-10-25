from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

from research import MODELS_DIR, REPO, RESULTS_DIR, Model, find_model

CHUNK = 8 * 1024 * 1024
REUSE_DIR = REPO / "spikes/transcribe-macos"


def expected_sha256(model: Model) -> str:
    url = f"https://huggingface.co/api/models/{model.repo}/tree/{model.revision}"
    with urllib.request.urlopen(url) as response:
        entries = json.load(response)
    match = [entry for entry in entries if entry["path"] == model.file]
    if not match or "lfs" not in match[0]:
        raise SystemExit(f"no lfs entry for {model.file} in {model.repo}")
    return match[0]["lfs"]["oid"]


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def stream_download(model: Model, target: Path) -> str:
    temp = target.with_suffix(target.suffix + ".download")
    digest = hashlib.sha256()
    with urllib.request.urlopen(model.url) as response, open(temp, "wb") as handle:
        for block in iter(lambda: response.read(CHUNK), b""):
            digest.update(block)
            handle.write(block)
    temp.rename(target)
    return digest.hexdigest()


def obtain(model: Model) -> str:
    target = model.path
    reuse = REUSE_DIR / model.file
    if target.exists():
        return sha256_of(target)
    if reuse.exists():
        target.symlink_to(reuse)
        return sha256_of(target)
    return stream_download(model, target)


def record(model: Model, actual: str) -> None:
    line = f"{model.id}\t{model.file}\t{model.path.stat().st_size}\t{actual}\n"
    with open(RESULTS_DIR / "sha256.tsv", "a") as handle:
        handle.write(line)


def main(model_ids: list[str]) -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    for model_id in model_ids:
        model = find_model(model_id)
        expected = expected_sha256(model)
        actual = obtain(model)
        if actual != expected:
            model.path.unlink()
            raise SystemExit(f"sha256 mismatch for {model.id}: {actual} != {expected}")
        record(model, actual)
        print(f"ok {model.id} {model.path.stat().st_size} {actual}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
