from __future__ import annotations

import csv
import json
import math

from research import HERE, REPO, RESULTS_DIR, find_model, load_models

TRANSCRIBE_CATALOG = REPO / "spikes/transcribe-macos/transcribe.cpp/catalog"
TARGET = REPO / "docs/research/model-catalog.draft.json"
HALF_GIB = 512 * 1024 * 1024
ENGINE = {"transcribe": "transcribe.cpp", "whisper": "whisper.cpp"}


def hashes() -> dict[str, dict]:
    with open(RESULTS_DIR / "sha256.tsv", newline="") as handle:
        rows = csv.reader(handle, delimiter="\t")
        return {row[0]: {"size": int(row[2]), "sha256": row[3]} for row in rows}


def largest_working_set() -> int:
    summary = json.loads((RESULTS_DIR / "summary.json").read_text())
    mapped = {model.id for model in load_models().values() if model.engine == "transcribe"}
    footprints = [value["footprint"] for platform in summary.values() for model_id, model in platform.items() if model_id in mapped for value in model.values() if isinstance(value, dict) and "footprint" in value]
    return max(footprints)


def minimum_ram(size: int, working_set: int) -> int:
    return math.ceil((size + working_set) / HALF_GIB) * HALF_GIB


def languages(variant: str) -> list[str]:
    record = json.loads((TRANSCRIBE_CATALOG / f"{variant}.json").read_text())
    return record["languages"]


def entry(selection: dict, known: dict[str, dict], working_set: int) -> dict:
    model = find_model(selection["id"])
    measured = known[model.id]
    return {
        "id": model.id,
        "name": selection["name"],
        "engine": ENGINE[model.engine],
        "quantization": selection["quantization"],
        "languages": languages(selection["variant"]),
        "languageHint": selection["languageHint"],
        "sizeBytes": measured["size"],
        "minRamBytes": minimum_ram(measured["size"], working_set),
        "license": selection["license"],
        "licenseUrl": selection["licenseUrl"],
        "attribution": selection["attribution"],
        "upstream": selection["upstream"],
        "source": {"repo": model.repo, "revision": model.revision, "file": model.file, "url": model.url},
        "sha256": measured["sha256"],
        "roles": selection["roles"],
        "roleLabels": selection["roleLabels"],
    }


def main() -> None:
    known = hashes()
    working_set = largest_working_set()
    selection = json.loads((HERE / "catalog-selection.json").read_text())
    models = [entry(item, known, working_set) for item in selection["models"]]
    catalog = {"schema": 1, "status": "draft", "defaults": selection["defaults"], "models": models}
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {TARGET}")


if __name__ == "__main__":
    main()
