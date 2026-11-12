import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSttConfig } from '../src/config';
import { ServerModelManifest, type ModelFile, type ModelRole } from '../src/model-manifest';
import { provision, provisionManifest } from '../src/provision';

const CONTENT = Buffer.from('fake gguf model bytes '.repeat(5000));
const CONTENT_SHA256 = createHash('sha256').update(CONTENT).digest('hex');
const ROLES: readonly ModelRole[] = ['verbatim', 'conditioned', 'language-id'];
const MANIFEST_CONTENT: Readonly<Record<ModelRole, Buffer>> = {
  verbatim: Buffer.from('parakeet '.repeat(4000)),
  conditioned: Buffer.from('canary '.repeat(3000)),
  'language-id': Buffer.from('voxlingua '.repeat(2000)),
};
const CONTENT_BY_PATH: ReadonlyMap<string, Buffer> = new Map([['/model.gguf', CONTENT], ...ROLES.map((role): [string, Buffer] => [`/${role}.gguf`, MANIFEST_CONTENT[role]])]);

let dir: string;
let server: Server;
let url: string;
let downloads: number;
let requested: string[];

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function manifestFile(role: ModelRole): ModelFile {
  const content = MANIFEST_CONTENT[role];
  return { role, url: url.replace('model.gguf', `${role}.gguf`), sha256: sha256(content), size: content.length, target: join(dir, 'models', `${role}.gguf`) };
}

function localManifest(overrides: Partial<Record<ModelRole, Partial<ModelFile>>> = {}): ServerModelManifest {
  return new ServerModelManifest(ROLES.map((role) => ({ ...manifestFile(role), ...overrides[role] })));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-provision-'));
  downloads = 0;
  requested = [];
  server = createServer((request, response) => {
    const content = CONTENT_BY_PATH.get(request.url ?? '');
    if (content === undefined) {
      response.writeHead(404).end();
      return;
    }
    downloads += 1;
    requested.push(request.url ?? '');
    response.writeHead(200, { 'content-length': String(content.length) });
    response.end(content);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/model.gguf`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

describe('provision', () => {
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

describe('ServerModelManifest', () => {
  it('pins the three server models at the configured targets', () => {
    const manifest = ServerModelManifest.pinned(loadSttConfig({}));

    expect(manifest.files).toEqual([
      {
        role: 'verbatim',
        url: 'https://huggingface.co/handy-computer/parakeet-ultra-gguf/resolve/a1539be1b849ea7463b88343e5277b373d0c4ea9/parakeet-ultra-F16.gguf',
        sha256: 'cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d',
        size: 1_256_724_448,
        target: '/models/parakeet-ultra-F16.gguf',
      },
      {
        role: 'conditioned',
        url: 'https://huggingface.co/handy-computer/canary-1b-v2-gguf/resolve/692af661b140183b60e44f55ad03c59e1e77d078/canary-1b-v2-Q8_0.gguf',
        sha256: '224f83d1bc487b3303b495a7d6874912fdece93de19d1a04b550829c30a5d289',
        size: 1_144_290_016,
        target: '/models/canary-1b-v2-Q8_0.gguf',
      },
      {
        role: 'language-id',
        url: 'https://huggingface.co/handy-computer/lang-id-voxlingua107-ecapa-gguf/resolve/e59f0f3847e77723b7d58447ef9456fa0c7e9436/lang-id-voxlingua107-ecapa-Q8_0.gguf',
        sha256: '063e6cb0af3d53085fc7d68356dfde5ecee2ffa7bc79855f7e4ff930081bfe3a',
        size: 26_693_632,
        target: '/models/lang-id-voxlingua107-ecapa-Q8_0.gguf',
      },
    ]);
    expect(manifest.extraBytes()).toBe(1_170_983_648);
  });

  it('follows overridden model paths', () => {
    const manifest = ServerModelManifest.pinned(loadSttConfig({ STT_MODEL_PATH: '/m/p.gguf', STT_CONDITIONED_MODEL_PATH: '/m/c.gguf', STT_LID_MODEL_PATH: '/m/l.gguf' }));

    expect(manifest.files.map((file) => file.target)).toEqual(['/m/p.gguf', '/m/c.gguf', '/m/l.gguf']);
  });
});

describe('provisionManifest', () => {
  it('downloads and verifies every missing model', async () => {
    const manifest = localManifest();

    const provisioned = await provisionManifest(manifest);

    expect(provisioned.map(({ file, result }) => [file.role, result])).toEqual(ROLES.map((role) => [role, 'downloaded']));
    for (const role of ROLES) {
      expect(await readFile(manifestFile(role).target)).toEqual(MANIFEST_CONTENT[role]);
    }
    expect(requested).toEqual(ROLES.map((role) => `/${role}.gguf`));
  });

  it('verifies models that are already present without downloading them', async () => {
    const manifest = localManifest();
    await provisionManifest(manifest);
    requested = [];

    expect((await provisionManifest(manifest)).map(({ result }) => result)).toEqual(['present', 'present', 'present']);
    expect(requested).toEqual([]);
  });

  it.each(ROLES)('keeps a present %s model and downloads the others', async (present) => {
    const manifest = localManifest();
    await mkdir(join(dir, 'models'), { recursive: true });
    await writeFile(manifestFile(present).target, MANIFEST_CONTENT[present]);

    const provisioned = await provisionManifest(manifest);

    expect(provisioned.map(({ file, result }) => [file.role, result])).toEqual(ROLES.map((role) => [role, role === present ? 'present' : 'downloaded']));
    expect(requested).toEqual(ROLES.filter((role) => role !== present).map((role) => `/${role}.gguf`));
  });

  it.each(ROLES)('replaces a corrupted %s model', async (corrupted) => {
    const manifest = localManifest();
    await mkdir(join(dir, 'models'), { recursive: true });
    await writeFile(manifestFile(corrupted).target, 'corrupted');

    await provisionManifest(manifest);

    expect(await readFile(manifestFile(corrupted).target)).toEqual(MANIFEST_CONTENT[corrupted]);
  });

  it.each(ROLES)('stops at a %s download whose hash does not match', async (mismatched) => {
    const manifest = localManifest({ [mismatched]: { sha256: '0'.repeat(64) } });
    const index = ROLES.indexOf(mismatched);

    await expect(provisionManifest(manifest)).rejects.toThrow(/SHA-256/);

    expect(ROLES.map((role) => existsSync(manifestFile(role).target))).toEqual(ROLES.map((_role, position) => position < index));
    expect(existsSync(`${manifestFile(mismatched).target}.download`)).toBe(false);
    expect(requested).toEqual(ROLES.slice(0, index + 1).map((role) => `/${role}.gguf`));
  });
});
