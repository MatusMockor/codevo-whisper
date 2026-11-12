import os
import struct
import sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)


def frame(language: bytes, samples: int, body: bytes = b'') -> bytes:
    return bytes([len(language)]) + language + struct.pack('<I', samples) + body


def langid(codes, samples: int, body: bytes = b'') -> bytes:
    header = bytes([0xfe, len(codes)])
    for code in codes:
        header += bytes([len(code)]) + code
    return header + struct.pack('<I', samples) + body


SUPPORTED = b'bg cs da de el en es et fi fr hr hu it lt lv mt nl pl pt ro ru sk sl sv uk'.split()
WIDEST = [b'a' + bytes([97 + index // 26, 97 + index % 26]) for index in range(33)]

seeds = {
    'auto-empty': frame(b'', 0),
    'sk-small': frame(b'sk', 4, b'\x00\x00\xff\x7f\x00\x80\xff\xff'),
    'lang-15': frame(b'a' * 15, 1, b'\x00\x00'),
    'lang-16': frame(b'a' * 16, 1, b'\x00\x00'),
    'lang-255': frame(b'a' * 255, 1, b'\x00\x00'),
    'lang-nul': frame(b's\x00', 1, b'\x00\x00'),
    'samples-max': frame(b'cs', 480000),
    'samples-max-plus-one': frame(b'en', 480001),
    'samples-uint32-max': frame(b'sk', 0xFFFFFFFF),
    'truncated-header': frame(b'sk', 10)[:4],
    'truncated-body': frame(b'sk', 10, b'\x01' * 7),
    'concatenated': frame(b'sk', 2, b'\x01\x02\x03\x04') + frame(b'', 1, b'\x05\x06') + frame(b'cs', 0),
    'concatenated-truncated': frame(b'en', 1, b'\x01\x02') + frame(b'sk', 3, b'\x01'),
    'langid-sk-cs-en': langid([b'sk', b'cs', b'en'], 4, b'\x00\x00\xff\x7f\x00\x80\xff\xff'),
    'langid-supported': langid(SUPPORTED, 1, b'\x00\x00'),
    'langid-three-letter': langid([b'yue'], 1, b'\x00\x00'),
    'langid-count-32': langid(WIDEST[:32], 1, b'\x00\x00'),
    'langid-count-33': langid(WIDEST, 1, b'\x00\x00'),
    'langid-count-0': langid([], 0),
    'langid-code-1': langid([b's'], 1, b'\x00\x00'),
    'langid-code-4': langid([b'slov'], 1, b'\x00\x00'),
    'langid-uppercase': langid([b'SK'], 1, b'\x00\x00'),
    'langid-nul': langid([b's\x00'], 1, b'\x00\x00'),
    'langid-duplicate': langid([b'sk', b'cs', b'sk'], 1, b'\x00\x00'),
    'langid-samples-max': langid([b'sk'], 480000),
    'langid-samples-max-plus-one': langid([b'sk'], 480001),
    'langid-samples-uint32-max': langid([b'sk'], 0xFFFFFFFF),
    'langid-truncated-header': langid([b'sk', b'cs'], 10)[:6],
    'langid-truncated-body': langid([b'sk'], 10, b'\x01' * 7),
    'mixed-concatenated': frame(b'sk', 1, b'\x01\x02') + langid([b'sk', b'cs'], 2, b'\x01\x02\x03\x04') + frame(b'de', 0),
}
for name, data in seeds.items():
    with open(os.path.join(out, name), 'wb') as handle:
        handle.write(data)
