import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def request(language, samples):
    encoded = language.encode()
    return bytes([len(encoded)]) + encoded + struct.pack('<I', len(samples)) + struct.pack('<' + 'h' * len(samples), *samples)


def frames(data):
    result = []
    while data:
        status, size = struct.unpack('<BI', data[:5])
        result.append((status, data[5:5 + size].decode()))
        data = data[5 + size:]
    return result


class Initialization(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory()
        cls.binary = str(Path(cls.scratch.name) / 'worker')
        subprocess.run([os.environ.get('CC', 'cc'), '-D_POSIX_C_SOURCE=200809L', '-D__APPLE__', '-std=c11', '-Wall', '-Wextra', '-Werror', '-I', str(ROOT / 'test/stub'), str(ROOT / 'stt-worker.c'), str(ROOT / 'stt-worker-request.c'), str(ROOT / 'test/stub/transcribe.c'), '-o', cls.binary], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_worker(self, model, backend='metal', body=b''):
        return subprocess.run([self.binary, '--model', model, '--backend', backend, '--threads', '3'], input=body, capture_output=True, timeout=5)

    def test_failed_metal_retries_cpu_before_ready_and_serves_frames(self):
        result = self.run_worker('fail-metal', body=request('sk', [16384, 0, -16384]) + request('', [0]))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(frames(result.stdout), [(2, ''), (0, 'sk 3 0.50'), (0, 'auto 1 0.00')])
        self.assertEqual(result.stderr.decode().splitlines(), ['OPEN 2 fail-metal 3', 'OPEN 1 fail-metal 3', 'RUN', 'RUN', 'FREE'])

    def test_both_failed_opens_emit_failure_without_ready(self):
        result = self.run_worker('fail-both')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(frames(result.stdout), [(1, 'model load failed')])
        self.assertEqual(result.stderr.decode().splitlines(), ['OPEN 2 fail-both 3', 'OPEN 1 fail-both 3'])

    def test_success_and_inference_failure_never_reopen_or_replay(self):
        result = self.run_worker('success', body=request('en', [0, 0]) + request('cs', [0]))
        self.assertEqual(frames(result.stdout), [(2, ''), (1, 'run failed'), (0, 'cs 1 0.00')])
        self.assertEqual(result.stderr.decode().splitlines(), ['OPEN 2 success 3', 'RUN', 'RUN', 'FREE'])

    def test_cpu_and_vulkan_failures_never_retry(self):
        for backend in ['cpu', 'vulkan']:
            result = self.run_worker('fail-both', backend)
            self.assertEqual(frames(result.stdout), [(1, 'model load failed')])
            self.assertEqual(len(result.stderr.decode().splitlines()), 1)


if __name__ == '__main__':
    unittest.main()
