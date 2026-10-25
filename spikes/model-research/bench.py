from __future__ import annotations

import argparse
import json
import tempfile
from dataclasses import asdict
from pathlib import Path

from engines import Engine, Platform, engine_for
from research import DATA_DIR, RESULTS_DIR, SAMPLE_WAV, Model, find_model

SET_LANGUAGE = {"sk": "sk", "cs": "cs", "en": "en", "sample": "sk"}
WRONG_LANGUAGE = {"sk": "en", "cs": "en", "en": "sk", "sample": "en"}
NEIGHBOR_LANGUAGE = {"sk": "cs", "cs": "sk", "en": "en", "sample": "cs"}


def load_set(name: str, limit: int) -> list[dict]:
    with open(DATA_DIR / "sets" / f"{name}.jsonl") as handle:
        rows = [json.loads(line) for line in handle]
    return rows[:limit] if limit else rows


def write_rows(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def run_cold(engine: Engine, model: Model, rows: list[dict], lang, work: Path) -> list[dict]:
    results = []
    for row in rows:
        run = engine.cold(model, row["wav"], lang, work)
        results.append({"id": row["id"], "duration": row["duration"], "hyp": run.hyp, "wall": run.wall, "rss": run.memory.rss, "footprint": run.memory.footprint, "detected": run.detected})
    return results


def run_warm(engine: Engine, model: Model, rows: list[dict], lang: str, work: Path) -> list[dict]:
    run = engine.warm(model, [str(SAMPLE_WAV)] + [row["wav"] for row in rows], lang, work)
    items = run.items[1:]
    if len(items) != len(rows):
        raise SystemExit(f"warm run returned {len(items)} items for {len(rows)} inputs")
    return [{"id": row["id"], "duration": row["duration"], "hyp": item.hyp, "wall": item.wall, "rss": run.memory.rss, "footprint": run.memory.footprint} for row, item in zip(rows, items)]


def first_run(engine: Engine, model: Model, out_dir: Path, work: Path) -> None:
    marker = out_dir / "first-run.json"
    if marker.exists():
        return
    run = engine.cold(model, str(SAMPLE_WAV), "sk", work)
    out_dir.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps({"wall": run.wall, **asdict(run.memory)}))


def run_mode(engine: Engine, model: Model, set_name: str, mode: str, limit: int, work: Path) -> list[dict]:
    rows = load_set(set_name, limit)
    lang = SET_LANGUAGE[set_name]
    if mode == "warm":
        return run_warm(engine, model, rows, lang, work)
    if mode == "auto":
        return run_cold(engine, model, rows, None, work)
    if mode == "mismatch":
        return run_cold(engine, model, rows, WRONG_LANGUAGE[set_name], work)
    if mode == "neighbor":
        return run_cold(engine, model, rows, NEIGHBOR_LANGUAGE[set_name], work)
    return run_cold(engine, model, rows, lang, work)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model")
    parser.add_argument("--sets", default="sample,sk,cs,en")
    parser.add_argument("--modes", default="warm,cold")
    parser.add_argument("--arch", default="arm64")
    parser.add_argument("--backend", default="metal")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    model = find_model(args.model)
    platform = Platform(args.arch, args.backend, args.threads)
    engine = engine_for(model, platform)
    out_dir = RESULTS_DIR / platform.label / model.id
    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp)
        first_run(engine, model, out_dir, work)
        for set_name in args.sets.split(","):
            for mode in args.modes.split(","):
                write_rows(out_dir / f"{set_name}.{mode}.jsonl", run_mode(engine, model, set_name, mode, args.limit, work))
                print(f"{model.id} {platform.label} {set_name} {mode} done", flush=True)


if __name__ == "__main__":
    main()
