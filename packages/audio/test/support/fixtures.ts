import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePcm16le } from '../../src/pcm/pcm-format';

export type FixtureName = 'speech-pauses' | 'speech-continuous';

export function loadFixture(name: FixtureName): Int16Array {
  return decodePcm16le(new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', `${name}.pcm`))));
}

export function toBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    view.setInt16(index * 2, sample, true);
  });
  return bytes;
}

export function concatSamples(...parts: Int16Array[]): Int16Array {
  const joined = new Int16Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}
