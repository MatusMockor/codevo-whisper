from __future__ import annotations

import csv
import os
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
ROOT = Path(os.environ.get("RESEARCH_ROOT", Path.home() / "Library/Caches/codevo-whisper-research"))
MODELS_DIR = ROOT / "models"
DATA_DIR = ROOT / "data"
RESULTS_DIR = ROOT / "results"
SAMPLE_WAV = REPO / "spikes/transcribe-macos/sample.wav"
SAMPLE_REF = "Ahoj, toto je skúška prepisu slovenskej reči na grafickej karte. Potrebujem skontrolovať náš editor a potom odoslať zmenu."


@dataclass(frozen=True)
class Model:
    id: str
    engine: str
    repo: str
    revision: str
    file: str

    @property
    def path(self) -> Path:
        return MODELS_DIR / self.file

    @property
    def url(self) -> str:
        return f"https://huggingface.co/{self.repo}/resolve/{self.revision}/{self.file}"


def load_models() -> dict[str, Model]:
    with open(HERE / "models.tsv", newline="") as handle:
        rows = csv.DictReader(handle, delimiter="\t")
        return {row["id"]: Model(**row) for row in rows}


def find_model(model_id: str) -> Model:
    models = load_models()
    if model_id not in models:
        raise SystemExit(f"unknown model id: {model_id}")
    return models[model_id]
