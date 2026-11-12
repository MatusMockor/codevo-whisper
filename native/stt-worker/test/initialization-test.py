import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [str(ROOT / name) for name in ['stt-worker.c', 'stt-worker-request.c', 'stt-worker-asr.c', 'stt-worker-langid.c', 'test/stub/transcribe.c']]


def request(language, samples, vocabulary=None):
    encoded = language.encode()
    header = bytes([len(encoded)]) + encoded + struct.pack('<I', len(samples))
    if vocabulary:
        header = b'\xff' + header + bytes([len(vocabulary)])
        for word in vocabulary:
            term = word.encode() if isinstance(word, str) else word
            header += struct.pack('<H', len(term)) + term
    return header + struct.pack('<' + 'h' * len(samples), *samples)


def langid_request(codes, samples):
    header = bytes([0xfe, len(codes)])
    for code in codes:
        encoded = code.encode() if isinstance(code, str) else code
        header += bytes([len(encoded)]) + encoded
    return header + struct.pack('<I', len(samples)) + struct.pack('<' + 'h' * len(samples), *samples)


SUPPORTED = 'bg cs da de el en es et fi fr hr hu it lt lv mt nl pl pt ro ru sk sl sv uk'.split()
SPEECH = [16384] + [0] * 7999
SILENCE = [0] * 8000


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
        subprocess.run([os.environ.get('CC', 'cc'), '-D_POSIX_C_SOURCE=200809L', '-D__APPLE__', '-std=c11', '-Wall', '-Wextra', '-Werror', '-I', str(ROOT / 'test/stub'), *SOURCES, '-o', cls.binary], check=True)
        cls.linux_binary = str(Path(cls.scratch.name) / 'linux-worker')
        subprocess.run([os.environ.get('CC', 'cc'), '-D_POSIX_C_SOURCE=200809L', '-std=c11', '-Wall', '-Wextra', '-Werror', '-I', str(ROOT / 'test/stub'), *SOURCES, '-o', cls.linux_binary], check=True)

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
        self.assertEqual(result.stderr.decode().splitlines(), ['LOAD 0 supports-vocabulary', 'SESSION 3', 'RUN', 'FREE', 'UNLOAD'])

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
        self.assertEqual(result.stderr.decode().splitlines(), ['LOAD 2 fail-metal', 'LOAD 1 fail-metal', 'SESSION 3', 'RUN', 'RUN', 'FREE', 'UNLOAD'])

    def test_both_failed_opens_emit_failure_without_ready(self):
        result = self.run_worker('fail-both')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(frames(result.stdout), [(1, 'model load failed')])
        self.assertEqual(result.stderr.decode().splitlines(), ['LOAD 2 fail-both', 'LOAD 1 fail-both'])

    def test_success_and_inference_failure_never_reopen_or_replay(self):
        result = self.run_worker('success', body=request('en', [0, 0]) + request('cs', [0]))
        self.assertEqual(frames(result.stdout), [(2, ''), (1, 'run failed'), (0, 'cs 1 0.00')])
        self.assertEqual(result.stderr.decode().splitlines(), ['LOAD 2 success', 'SESSION 3', 'RUN', 'RUN', 'FREE', 'UNLOAD'])

    def test_cpu_and_vulkan_failures_never_retry(self):
        for backend in ['cpu', 'vulkan']:
            result = self.run_worker('fail-both', backend)
            self.assertEqual(frames(result.stdout), [(1, 'model load failed')])
            self.assertEqual(len(result.stderr.decode().splitlines()), 1)

    def test_asr_accepts_every_supported_language(self):
        result = self.run_worker('success', body=b''.join(request(code, [0]) for code in SUPPORTED))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(frames(result.stdout), [(2, '')] + [(0, f'{code} 1 0.00') for code in SUPPORTED])

    def test_langid_model_replies_the_ranked_allowed_codes(self):
        result = self.run_worker('langid', body=langid_request(['sk', 'cs', 'en'], SPEECH) + langid_request(['sk'], SILENCE))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(frames(result.stdout), [(2, ''), (0, 'en 0.5\ncs 0.25\nsk 0.25\n'), (0, 'sk 1\n')])
        self.assertEqual(result.stderr.decode().splitlines(), ['LOAD 2 langid', 'LANGID SESSION 3', 'LANGID 3 [sk] [cs] [en] 0.50', 'LANGID 1 [sk] 0.00', 'FREE', 'UNLOAD'])

    def test_langid_accepts_the_supported_set_and_the_maximum_count(self):
        widest = ['a' + chr(97 + index // 26) + chr(97 + index % 26) for index in range(32)]
        result = self.run_worker('langid', body=langid_request(SUPPORTED, SILENCE) + langid_request(widest, SILENCE))
        self.assertEqual(result.returncode, 0, result.stderr)
        replies = frames(result.stdout)
        self.assertEqual([status for status, _ in replies], [2, 0, 0])
        self.assertEqual([line.split(' ')[0] for line in replies[1][1].splitlines()], list(reversed(SUPPORTED)))
        self.assertEqual([line.split(' ')[0] for line in replies[2][1].splitlines()], list(reversed(widest)))

    def test_langid_failures_reply_failed_and_keep_serving(self):
        body = langid_request(['sk'], [0] * 7999) + langid_request(['sk', 'xx'], SILENCE) + langid_request(['sk', 'cs'], SILENCE)
        result = self.run_worker('langid', body=body)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(frames(result.stdout), [(2, ''), (1, 'input audio too short'), (1, 'unsupported language'), (0, 'cs 0.5\nsk 0.5\n')])

    def test_a_frame_for_the_other_role_gets_wrong_role_and_the_stream_stays_in_sync(self):
        result = self.run_worker('langid', body=request('sk', [0, 0, 0]) + langid_request(['sk'], SILENCE))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(frames(result.stdout), [(2, ''), (1, 'wrong role'), (0, 'sk 1\n')])
        self.assertNotIn('RUN', result.stderr.decode().splitlines())
        result = self.run_worker('success', body=langid_request(['sk', 'cs'], SPEECH) + request('cs', [0]))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(frames(result.stdout), [(2, ''), (1, 'wrong role'), (0, 'cs 1 0.00')])
        self.assertNotIn(b'LANGID', result.stderr)

    def test_rejects_malformed_langid_frames(self):
        malformed = [
            b'\xfe\x00' + struct.pack('<I', 0),
            langid_request(['a' + chr(97 + index // 26) + chr(97 + index % 26) for index in range(33)], [0]),
            langid_request(['s'], [0]),
            langid_request(['slov'], [0]),
            langid_request(['SK'], [0]),
            langid_request(['s1'], [0]),
            langid_request([b's\x00'], [0]),
            langid_request(['sk', 'cs', 'sk'], [0]),
            bytes([0xfe, 1, 2]) + b'sk' + struct.pack('<I', 480001),
            bytes([0xfe, 1, 2]) + b'sk' + struct.pack('<I', 0xFFFFFFFF),
        ]
        for body in malformed:
            result = self.run_worker('langid', body=body)
            self.assertEqual(result.returncode, 3, body[:12])
            self.assertEqual(frames(result.stdout), [(2, ''), (1, 'invalid request')])
            self.assertNotIn(b'LANGID 1', result.stderr)

    def test_truncated_langid_frames_exit_without_running(self):
        valid = langid_request(['sk', 'cs'], [0, 0])
        for length in range(1, len(valid)):
            result = self.run_worker('langid', body=valid[:length])
            self.assertEqual(result.returncode, 3, length)
            self.assertEqual(frames(result.stdout), [(2, '')])
            self.assertNotIn(b'LANGID 2', result.stderr)

    def test_failed_metal_langid_session_frees_the_model_and_retries_cpu(self):
        result = self.run_worker('langid-session-fails-on-metal', body=langid_request(['sk'], SILENCE))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(frames(result.stdout), [(2, ''), (0, 'sk 1\n')])
        self.assertEqual(result.stderr.decode().splitlines()[:5], ['LOAD 2 langid-session-fails-on-metal', 'LANGID SESSION 3', 'UNLOAD', 'LOAD 1 langid-session-fails-on-metal', 'LANGID SESSION 3'])

    def test_a_model_without_a_served_role_fails_to_load(self):
        result = self.run_worker('no-role', backend='cpu')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(frames(result.stdout), [(1, 'model load failed')])
        self.assertEqual(result.stderr.decode().splitlines(), ['LOAD 1 no-role', 'UNLOAD'])


if __name__ == '__main__':
    unittest.main()
