import os
import struct
import sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)


def frame(language: bytes, samples: int, body: bytes = b'') -> bytes:
    return bytes([len(language)]) + language + struct.pack('<I', samples) + body


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
}
for name, data in seeds.items():
    with open(os.path.join(out, name), 'wb') as handle:
        handle.write(data)
