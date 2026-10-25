import { crc32, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH = 8;
const COLOR_TYPE_RGBA = 6;

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function header(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.writeUInt8(BIT_DEPTH, 8);
  data.writeUInt8(COLOR_TYPE_RGBA, 9);
  return data;
}

function scanlines(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  return raw;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.byteLength !== width * height * 4) {
    throw new RangeError(`Expected ${width * height * 4} RGBA bytes, got ${rgba.byteLength}`);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header(width, height)),
    chunk('IDAT', deflateSync(scanlines(width, height, rgba))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
