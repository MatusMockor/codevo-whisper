from __future__ import annotations

import json
import sys

from research import RESULTS_DIR

HEADER = "| Model | Engine | Size | WER % [95% CI] | CER % | Warm median / p95 (s) | Cold median / p95 (s) | RTF warm | Peak footprint | Auto-detect WER % |"
RULE = "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"


def engine_of(model_id: str) -> str:
    if model_id.startswith("wc-"):
        return "whisper.cpp"
    return "transcribe.cpp"


def size_text(size) -> str:
    if not size:
        return "-"
    return f"{size / 1e6:,.0f} MB"


def auto_text(entry: dict, lang: str) -> str:
    auto = entry.get(f"{lang}.auto")
    if not auto:
        return "-"
    detected = ",".join(auto["detected"])
    return f"{auto['wer'] * 100:.1f}" + (f" ({detected})" if detected else "")


def row(model_id: str, entry: dict, lang: str) -> str:
    warm = entry[f"{lang}.warm"]
    cold = entry[f"{lang}.cold"]
    footprint = max(warm["footprint"], cold["footprint"]) / 1e6
    wer = f"{warm['wer'] * 100:.1f} [{warm['wer_ci'][0] * 100:.1f}-{warm['wer_ci'][1] * 100:.1f}]"
    cells = [model_id, engine_of(model_id), size_text(entry.get("size")), wer, f"{warm['cer'] * 100:.1f}",
             f"{warm['median']:.3f} / {warm['p95']:.3f}", f"{cold['median']:.3f} / {cold['p95']:.3f}",
             f"{warm['rtf']:.4f}", f"{footprint:,.0f} MB", auto_text(entry, lang)]
    return "| " + " | ".join(cells) + " |"


def render(platform: str, lang: str) -> None:
    summary = json.loads((RESULTS_DIR / "summary.json").read_text())[platform]
    present = [(model_id, entry) for model_id, entry in summary.items() if f"{lang}.warm" in entry and f"{lang}.cold" in entry]
    ordered = sorted(present, key=lambda item: item[1][f"{lang}.warm"]["wer"])
    print(HEADER)
    print(RULE)
    for model_id, entry in ordered:
        print(row(model_id, entry, lang))


if __name__ == "__main__":
    render(sys.argv[1], sys.argv[2])
