from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

from research import DATA_DIR, RESULTS_DIR, load_models
from score import bootstrap_interval, error_rates, utterance_counts

SETS = ["sk", "cs", "en", "sample"]
MODES = ["warm", "cold", "auto", "mismatch", "neighbor"]


def load_jsonl(path: Path) -> list[dict]:
    with open(path) as handle:
        return [json.loads(line) for line in handle]


def references(set_name: str) -> dict[str, str]:
    return {row["id"]: row["ref"] for row in load_jsonl(DATA_DIR / "sets" / f"{set_name}.jsonl")}


def percentile(values: list[float], share: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(share * (len(ordered) - 1))))
    return ordered[index]


def summarize(rows: list[dict], refs: dict[str, str]) -> dict:
    ref_texts = [refs[row["id"]] for row in rows]
    hyp_texts = [row["hyp"] for row in rows]
    wer, cer = error_rates(ref_texts, hyp_texts)
    low, high = bootstrap_interval(utterance_counts(ref_texts, hyp_texts))
    walls = [row["wall"] for row in rows]
    detected = [row.get("detected") for row in rows if row.get("detected")]
    return {
        "n": len(rows),
        "wer": wer,
        "cer": cer,
        "wer_ci": [low, high],
        "median": statistics.median(walls),
        "p95": percentile(walls, 0.95),
        "rtf": sum(walls) / sum(row["duration"] for row in rows),
        "rss": max(row["rss"] for row in rows),
        "footprint": max(row["footprint"] for row in rows),
        "detected": sorted(set(detected)),
    }


def collect(platform: str) -> dict:
    summary = {}
    base = RESULTS_DIR / platform
    for model_dir in sorted(path for path in base.iterdir() if path.is_dir()):
        entry = {}
        first = model_dir / "first-run.json"
        if first.exists():
            entry["first_run"] = json.loads(first.read_text())
        for set_name in SETS:
            refs = references(set_name)
            for mode in MODES:
                path = model_dir / f"{set_name}.{mode}.jsonl"
                if path.exists():
                    entry[f"{set_name}.{mode}"] = summarize(load_jsonl(path), refs)
        summary[model_dir.name] = entry
    return summary


def main(platforms: list[str]) -> None:
    models = load_models()
    output = {}
    for platform in platforms:
        output[platform] = collect(platform)
    for platform in output.values():
        for model_id, entry in platform.items():
            path = models[model_id].path if model_id in models else None
            entry["size"] = path.stat().st_size if path and path.exists() else None
    (RESULTS_DIR / "summary.json").write_text(json.dumps(output, indent=1, ensure_ascii=False))
    print(f"wrote {RESULTS_DIR / 'summary.json'}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["arm64-metal"])
