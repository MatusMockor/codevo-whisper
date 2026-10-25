from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Protocol

from research import REPO, ROOT, Model
from timing import Memory, timed_run
from warm import WarmRun, run_batch, run_server


@dataclass(frozen=True)
class Platform:
    arch: str
    backend: str
    threads: int

    @property
    def launcher(self) -> list[str]:
        if self.arch == "x86_64":
            return ["arch", "-x86_64"]
        return []

    @property
    def label(self) -> str:
        return f"{self.arch}-{self.backend}"


@dataclass(frozen=True)
class ColdRun:
    hyp: str
    wall: float
    memory: Memory
    detected: Optional[str]


class Engine(Protocol):
    def cold(self, model: Model, wav: str, lang: Optional[str], work: Path) -> ColdRun: ...

    def warm(self, model: Model, wavs: list[str], lang: str, work: Path) -> WarmRun: ...


class TranscribeCpp:
    DETECTED = re.compile(r"^detected-language:\s*(\S+)", re.MULTILINE)

    def __init__(self, platform: Platform):
        self.platform = platform
        default = REPO / f"spikes/transcribe-macos/build/{platform.arch}/bin/transcribe-cli"
        self.binary = os.environ.get("TRANSCRIBE_BIN", str(default))

    def base(self, model: Model, lang: Optional[str]) -> list[str]:
        command = self.platform.launcher + [self.binary, "-m", str(model.path), "--backend", self.platform.backend]
        command += ["--threads", str(self.platform.threads), "--timestamps", "none", "-q"]
        if lang:
            command += ["-l", lang]
        return command

    def cold(self, model: Model, wav: str, lang: Optional[str], work: Path) -> ColdRun:
        out = work / "cold.txt"
        timed = timed_run(self.base(model, lang) + ["-o", str(out), wav])
        detected = self.DETECTED.search(timed.stdout)
        return ColdRun(out.read_text().strip(), timed.wall, timed.memory, detected.group(1) if detected else None)

    def warm(self, model: Model, wavs: list[str], lang: str, work: Path) -> WarmRun:
        listing = work / "batch.list"
        listing.write_text("\n".join(wavs) + "\n")
        return run_batch(self.base(model, lang) + ["--batch", str(listing), "--batch-jsonl"], work / "batch.log")


class WhisperCpp:
    DETECTED = re.compile(r"auto-detected language:\s*(\S+)")

    def __init__(self, platform: Platform):
        self.platform = platform
        default = ROOT / f"engines/whisper.cpp/build/{platform.arch}/bin"
        self.bin_dir = Path(os.environ.get("WHISPER_BIN_DIR", str(default)))

    def common(self, model: Model, lang: Optional[str]) -> list[str]:
        command = ["-m", str(model.path), "-t", str(self.platform.threads), "-l", lang or "auto"]
        if self.platform.backend == "cpu":
            command.append("-ng")
        return command

    def cold(self, model: Model, wav: str, lang: Optional[str], work: Path) -> ColdRun:
        out = work / "cold"
        command = self.platform.launcher + [str(self.bin_dir / "whisper-cli")] + self.common(model, lang)
        command += ["-bs", "1", "-bo", "1", "-nt", "-otxt", "-of", str(out), "-f", wav]
        timed = timed_run(command)
        detected = self.DETECTED.search(timed.stderr)
        hyp = " ".join(Path(f"{out}.txt").read_text(errors="replace").split())
        return ColdRun(hyp, timed.wall, timed.memory, detected.group(1) if detected else None)

    def warm(self, model: Model, wavs: list[str], lang: str, work: Path) -> WarmRun:
        command = self.platform.launcher + [str(self.bin_dir / "whisper-server")] + self.common(model, lang)
        return run_server(command, wavs, work / "server.log")


def engine_for(model: Model, platform: Platform) -> Engine:
    if model.engine == "transcribe":
        return TranscribeCpp(platform)
    if model.engine == "whisper":
        return WhisperCpp(platform)
    raise SystemExit(f"unknown engine: {model.engine}")
