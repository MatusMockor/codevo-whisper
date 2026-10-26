import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { encodePcm16le, PCM_BYTES_PER_SECOND, PCM_SAMPLE_RATE } from '../../src/shared/pcm';
import { timelineWords } from './timeline-words.js';

const FIXTURES = ['speech-pauses.pcm', 'speech-continuous.pcm'].map((name) =>
  fileURLToPath(new URL(`../../../../packages/audio/test/fixtures/${name}`, import.meta.url)),
);

const DITHER = 9;
const SEED_SHIFT_SAMPLES = 7 * PCM_SAMPLE_RATE;

function fixtureSamples(file: string): Int16Array {
  const bytes = readFileSync(file);
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength - (bytes.byteLength % 2)));
}

function dithered(seconds: number, seed: number, pick: (index: number) => number): Int16Array {
  const samples = new Int16Array(Math.round(seconds * PCM_SAMPLE_RATE));
  let state = (0x9e3779b9 + seed) >>> 0;
  for (let index = 0; index < samples.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const noise = (state >>> 16) % DITHER - Math.floor(DITHER / 2);
    samples[index] = Math.max(-32768, Math.min(32767, pick(index) + noise));
  }
  return samples;
}

export function timelineSpeech(seconds: number, seed = 0): Int16Array {
  const fixtures = FIXTURES.map(fixtureSamples);
  const joined = fixtures.flatMap((fixture) => [...fixture]);
  return dithered(seconds, seed, (index) => joined[(index + seed * SEED_SHIFT_SAMPLES) % joined.length] ?? 0);
}

export function timelineSilence(seconds: number, seed = 0): Int16Array {
  return dithered(seconds, seed, () => 0);
}

export function joinSamples(...parts: Int16Array[]): Int16Array {
  const joined = new Int16Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export function pcmBytes(samples: Int16Array): Uint8Array {
  return encodePcm16le(samples);
}

export function secondFrames(samples: Int16Array): Uint8Array[] {
  const bytes = pcmBytes(samples);
  const frames: Uint8Array[] = [];
  for (let start = 0; start < bytes.byteLength; start += PCM_BYTES_PER_SECOND) {
    frames.push(bytes.slice(start, Math.min(bytes.byteLength, start + PCM_BYTES_PER_SECOND)));
  }
  return frames;
}

export function expectedText(samples: Int16Array): string {
  return timelineWords(samples, 0, samples.length).join(' ');
}

export async function writeTimeline(file: string, samples: Int16Array): Promise<void> {
  await writeFile(file, pcmBytes(samples));
}
