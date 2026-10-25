from __future__ import annotations

import json
import signal
import subprocess
import time
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path

from timing import TIME_PREFIX, Memory, parse_memory

PORT = 18765
READY_TIMEOUT = 120.0


@dataclass(frozen=True)
class WarmItem:
    hyp: str
    wall: float


@dataclass(frozen=True)
class WarmRun:
    items: list[WarmItem]
    memory: Memory


def run_batch(command: list[str], log: Path) -> WarmRun:
    with open(log, "w") as handle:
        process = subprocess.Popen(TIME_PREFIX + command, stdout=subprocess.PIPE, stderr=handle, text=True)
        items = collect_batch(process)
        code = process.wait()
    stderr = log.read_text(errors="replace")
    if code != 0:
        raise SystemExit(f"batch failed: {stderr[-2000:]}")
    return WarmRun(items, parse_memory(stderr))


def collect_batch(process: subprocess.Popen) -> list[WarmItem]:
    items = []
    previous = time.perf_counter()
    for line in process.stdout:
        now = time.perf_counter()
        record = json.loads(line) if line.startswith("{") else {}
        if "file" not in record:
            previous = now
            continue
        items.append(WarmItem(" ".join(record["text"].split()), now - previous))
        previous = now
    return items


def multipart(wav: str, fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode() for key, value in fields.items()]
    header = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'
    body = b"".join(parts) + header.encode() + Path(wav).read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def post(wav: str) -> WarmItem:
    body, content_type = multipart(wav, {"response_format": "json", "temperature": "0.0"})
    request = urllib.request.Request(f"http://127.0.0.1:{PORT}/inference", data=body, headers={"Content-Type": content_type})
    start = time.perf_counter()
    with urllib.request.urlopen(request) as response:
        text = json.load(response)["text"]
    return WarmItem(" ".join(text.split()), time.perf_counter() - start)


def wait_ready(process: subprocess.Popen) -> None:
    deadline = time.monotonic() + READY_TIMEOUT
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SystemExit("whisper-server exited during startup")
        if reachable():
            return
        time.sleep(0.2)
    raise SystemExit("whisper-server did not become ready")


def reachable() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=1):
            return True
    except OSError:
        return False


def stop(process: subprocess.Popen) -> None:
    children = subprocess.run(["pgrep", "-P", str(process.pid)], capture_output=True, text=True).stdout.split()
    for child in children:
        subprocess.run(["kill", "-TERM", child])
    if not children:
        process.send_signal(signal.SIGTERM)
    process.wait(timeout=30)


def run_server(command: list[str], wavs: list[str], log: Path) -> WarmRun:
    full = TIME_PREFIX + command + ["--host", "127.0.0.1", "--port", str(PORT)]
    with open(log, "w") as handle:
        process = subprocess.Popen(full, stdout=subprocess.DEVNULL, stderr=handle)
        try:
            wait_ready(process)
            items = [post(wav) for wav in wavs]
        finally:
            stop(process)
    return WarmRun(items, parse_memory(log.read_text(errors="replace")))
