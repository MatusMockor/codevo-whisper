import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MODEL_REVISION, MODEL_SHA256, MODEL_URL, provision } from '../src/provision';

const CONTENT = Buffer.from('fake gguf model bytes '.repeat(5000));
const CONTENT_SHA256 = createHash('sha256').update(CONTENT).digest('hex');

let dir: string;
let server: Server;
let url: string;
let downloads: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-provision-'));
  downloads = 0;
  server = createServer((request, response) => {
    if (request.url !== '/model.gguf') {
      response.writeHead(404).end();
      return;
    }
    downloads += 1;
    response.writeHead(200, { 'content-length': String(CONTENT.length) });
    response.end(CONTENT);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/model.gguf`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

describe('provision', () => {
  it('pins the Parakeet Ultra F16 model', () => {
    expect(MODEL_REVISION).toBe('a1539be1b849ea7463b88343e5277b373d0c4ea9');
    expect(MODEL_URL).toBe(
      'https://huggingface.co/handy-computer/parakeet-ultra-gguf/resolve/a1539be1b849ea7463b88343e5277b373d0c4ea9/parakeet-ultra-F16.gguf',
    );
    expect(MODEL_SHA256).toBe('cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d');
  });

  it('downloads and verifies', async () => {
    const target = join(dir, 'models', 'model.gguf');

    expect(await provision({ url, sha256: CONTENT_SHA256, target })).toBe('downloaded');
    expect(await readFile(target)).toEqual(CONTENT);
    expect(existsSync(`${target}.download`)).toBe(false);
  });

  it('returns present when hash matches', async () => {
    const target = join(dir, 'model.gguf');
    await writeFile(target, CONTENT);

    expect(await provision({ url, sha256: CONTENT_SHA256, target })).toBe('present');
    expect(downloads).toBe(0);
  });

  it('replaces a present file whose hash does not match', async () => {
    const target = join(dir, 'model.gguf');
    await writeFile(target, 'corrupted');

    expect(await provision({ url, sha256: CONTENT_SHA256, target })).toBe('downloaded');
    expect(await readFile(target)).toEqual(CONTENT);
  });

  it('deletes on mismatch and throws', async () => {
    const target = join(dir, 'model.gguf');

    await expect(provision({ url, sha256: '0'.repeat(64), target })).rejects.toThrow(/SHA-256/);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.download`)).toBe(false);
  });

  it('throws on an HTTP error without leaving files', async () => {
    const target = join(dir, 'model.gguf');

    await expect(provision({ url: url.replace('model.gguf', 'missing'), sha256: CONTENT_SHA256, target })).rejects.toThrow(/404/);
    expect(existsSync(`${target}.download`)).toBe(false);
  });
});
