from __future__ import annotations

import re
import subprocess
import time
from dataclasses import dataclass

TIME_PREFIX = ["/usr/bin/time", "-l"]
RSS = re.compile(r"(\d+)\s+maximum resident set size")
FOOTPRINT = re.compile(r"(\d+)\s+peak memory footprint")


@dataclass(frozen=True)
class Memory:
    rss: int
    footprint: int


@dataclass(frozen=True)
class Timed:
    wall: float
    stdout: str
    stderr: str
    memory: Memory


def parse_memory(stderr: str) -> Memory:
    rss = RSS.search(stderr)
    footprint = FOOTPRINT.search(stderr)
    return Memory(int(rss.group(1)) if rss else 0, int(footprint.group(1)) if footprint else 0)


def timed_run(command: list[str]) -> Timed:
    start = time.perf_counter()
    done = subprocess.run(TIME_PREFIX + command, capture_output=True, text=True, errors="replace")
    wall = time.perf_counter() - start
    if done.returncode != 0:
        raise SystemExit(f"command failed ({done.returncode}): {' '.join(command)}\n{done.stderr[-2000:]}")
    return Timed(wall, done.stdout, done.stderr, parse_memory(done.stderr))
