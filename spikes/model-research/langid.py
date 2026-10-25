from __future__ import annotations

import json
import re
import statistics
import sys

from bench import load_set
from engines import Platform
from research import REPO, RESULTS_DIR, find_model
from timing import timed_run

DECISION = re.compile(r"^language:\s*(\S+)", re.MULTILINE)
COMPUTE = re.compile(r"realtime:.*\(([\d.]+) ms")
ALLOWED = "sk,cs,en"


def classify(platform: Platform, model_path: str, wav: str) -> dict:
    binary = str(REPO / f"spikes/transcribe-macos/build/{platform.arch}/bin/transcribe-cli")
    command = platform.launcher + [binary, "-m", model_path, "--backend", platform.backend, "--threads", str(platform.threads), "--allow", ALLOWED, "--top", "3", wav]
    timed = timed_run(command)
    decision = DECISION.search(timed.stdout)
    compute = COMPUTE.search(timed.stdout)
    return {"label": decision.group(1) if decision else None, "wall": timed.wall, "compute_ms": float(compute.group(1)) if compute else None}


def main(backend: str) -> None:
    platform = Platform("arm64", backend, 4)
    model = find_model("langid-voxlingua107-q8")
    summary = {}
    for lang in ["sk", "cs", "en"]:
        results = [classify(platform, str(model.path), row["wav"]) for row in load_set(lang, 0)]
        labels = [result["label"] for result in results]
        summary[lang] = {
            "accuracy": sum(label == lang for label in labels) / len(labels),
            "confusions": {label: labels.count(label) for label in set(labels) if label != lang},
            "wall_median": statistics.median(result["wall"] for result in results),
            "compute_median_ms": statistics.median(result["compute_ms"] for result in results if result["compute_ms"] is not None),
        }
    target = RESULTS_DIR / f"langid-{platform.label}.json"
    target.write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "metal")
