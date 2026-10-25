from __future__ import annotations

import csv
import json
import random
import shutil
import subprocess
import sys
import tarfile
import wave
from pathlib import Path

from research import DATA_DIR, SAMPLE_REF, SAMPLE_WAV

PER_LANGUAGE = 30
SEED = 20261025
SOURCE = DATA_DIR / "fleurs-dl"
LANGUAGES = {"sk": "sk_sk", "cs": "cs_cz", "en": "en_us"}

csv.field_size_limit(sys.maxsize)


def read_rows(tsv: Path) -> dict[str, dict]:
    first_by_sentence: dict[str, dict] = {}
    with open(tsv, newline="") as handle:
        for row in csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE):
            sentence_id, file_name, raw = row[0], row[1], row[2]
            if sentence_id in first_by_sentence:
                continue
            first_by_sentence[sentence_id] = {"id": sentence_id, "file": file_name, "ref": raw}
    return first_by_sentence


def pick(rows: dict[str, dict]) -> list[dict]:
    ids = sorted(rows)
    chosen = random.Random(SEED).sample(ids, PER_LANGUAGE)
    return [rows[sentence_id] for sentence_id in chosen]


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        if handle.getframerate() != 16000 or handle.getnchannels() != 1:
            raise SystemExit(f"unexpected wav format: {path}")
        return handle.getnframes() / handle.getframerate()


def extract(tar_path: Path, wanted: set[str], out_dir: Path) -> None:
    with tarfile.open(tar_path, "r:gz") as archive:
        for member in archive:
            name = Path(member.name).name
            if not member.isfile() or name not in wanted:
                continue
            raw = out_dir / f"{name}.raw"
            with open(raw, "wb") as target:
                shutil.copyfileobj(archive.extractfile(member), target)
            to_pcm16(raw, out_dir / name)
            raw.unlink()


def to_pcm16(source: Path, target: Path) -> None:
    command = ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "wav", "-i", str(source), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(target)]
    subprocess.run(command, check=True)


def prepare_language(lang: str, fleurs_code: str) -> None:
    out_dir = DATA_DIR / "sets" / lang
    out_dir.mkdir(parents=True, exist_ok=True)
    chosen = pick(read_rows(SOURCE / fleurs_code / "test.tsv"))
    extract(SOURCE / fleurs_code / "test.tar.gz", {row["file"] for row in chosen}, out_dir)
    write_manifest(lang, [{**row, "wav": str(out_dir / row["file"])} for row in chosen])


def write_manifest(name: str, rows: list[dict]) -> None:
    with open(DATA_DIR / "sets" / f"{name}.jsonl", "w") as handle:
        for row in rows:
            row["duration"] = wav_duration(Path(row["wav"]))
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    for lang, fleurs_code in LANGUAGES.items():
        prepare_language(lang, fleurs_code)
        print(f"prepared {lang}", flush=True)
    write_manifest("sample", [{"id": "sample", "file": SAMPLE_WAV.name, "ref": SAMPLE_REF, "wav": str(SAMPLE_WAV)}])


if __name__ == "__main__":
    main()
