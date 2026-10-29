import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def request(language, samples, vocabulary=None):
    encoded = language.encode()
    header = bytes([len(encoded)]) + encoded + struct.pack('<I', len(samples))
    if vocabulary:
        header = b'\xff' + header + bytes([len(vocabulary)])
        for word in vocabulary:
            term = word.encode() if isinstance(word, str) else word
            header += struct.pack('<H', len(term)) + term
    return header + struct.pack('<' + 'h' * len(samples), *samples)


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
        cls.linux_binary = str(Path(cls.scratch.name) / 'linux-worker')
        subprocess.run([os.environ.get('CC', 'cc'), '-D_POSIX_C_SOURCE=200809L', '-std=c11', '-Wall', '-Wextra', '-Werror', '-I', str(ROOT / 'test/stub'), str(ROOT / 'stt-worker.c'), str(ROOT / 'stt-worker-request.c'), str(ROOT / 'test/stub/transcribe.c'), '-o', cls.linux_binary], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_worker(self, model, backend='metal', body=b'', vocabulary=False):
        env = dict(os.environ, CW_TEST_VOCABULARY='1') if vocabulary else None
        return subprocess.run([self.binary, '--model', model, '--backend', backend, '--threads', '3'], input=body, capture_output=True, timeout=5, env=env)

    def test_native_vocabulary_is_per_request_and_capability_gated(self):
        body = request('sk', [16384], ['Žilina', 'Kumiba']) + request('en', [0], ['Other']) + request('', [0])
        for model, expected in [('supports-vocabulary', ['VOCABULARY 2 [Žilina] [Kumiba]', 'VOCABULARY 1 [Other]', 'VOCABULARY 0']), ('unsupported', ['VOCABULARY 0'] * 3)]:
            result = self.run_worker(model, body=body, vocabulary=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(frames(result.stdout), [(2, ''), (0, 'sk 1 0.50'), (0, 'en 1 0.00'), (0, 'auto 1 0.00')])
            self.assertEqual([line for line in result.stderr.decode().splitlines() if line.startswith('VOCABULARY')], expected)

    def test_linux_auto_parser_uses_upstream_auto_without_native_replay(self):
        result = subprocess.run([self.linux_binary, '--model', 'supports-vocabulary', '--backend', 'auto', '--threads', '3'], input=request('sk', [0]), capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(frames(result.stdout), [(2, ''), (0, 'sk 1 0.00')])
        self.assertEqual(result.stderr.decode().splitlines(), ['OPEN 0 supports-vocabulary 3', 'RUN', 'FREE'])

    def test_rejects_malformed_vocabulary_and_truncated_extended_requests(self):
        for term in [b'', b'a\x00b', b'a\nb', b'a\xc2\x85b', b'\xff', b'\xc0\xaf', b'\xed\xa0\x80', b'\xf4\x90\x80\x80', b'a' * 65, '😀'.encode() * 65, b'a' * 257]:
            result = self.run_worker('supports-vocabulary', body=request('sk', [0], [term]))
            self.assertEqual(result.returncode, 3, term)
            self.assertNotIn(b'RUN', result.stderr)
        valid = request('sk', [0], ['Žilina'])
        for length in range(1, len(valid)):
            result = self.run_worker('supports-vocabulary', body=valid[:length])
            self.assertEqual(result.returncode, 3, length)
            self.assertNotIn(b'RUN', result.stderr)

    def test_accepts_maximum_vocabulary_and_rejects_count_overflow(self):
        result = self.run_worker('supports-vocabulary', body=request('sk', [0], ['😀' * 64] * 100))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(frames(result.stdout), [(2, ''), (0, 'sk 1 0.00')])
        result = self.run_worker('supports-vocabulary', body=request('sk', [0], ['word'] * 101))
        self.assertEqual(result.returncode, 3)

    def test_rejects_a_legacy_255_byte_language_as_invalid(self):
        result = self.run_worker('success', body=request('a' * 255, [0] * 10))
        self.assertEqual(result.returncode, 3)
        self.assertEqual(frames(result.stdout), [(2, ''), (1, 'invalid request')])

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
