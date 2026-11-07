import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiKeyStore } from '../src/main/ai/ai-key-store';
import { InsecureTestVault } from '../src/main/remote/insecure-test-vault';
import { RecordingLogger } from './recording-logger';

const KEY = 'sk-local-1234567890';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-ai-key-'));
  file = join(dir, 'ai-key.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('AiKeyStore', () => {
  it('starts without a key, seals a stored key in an owner-only file and reads it back after a restart', async () => {
    const store = new AiKeyStore(file, new InsecureTestVault());
    expect(await store.state()).toBe('none');
    expect(await store.get()).toBeNull();
    expect(await store.set(KEY)).toBe('stored');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).not.toContain(KEY);
    const restarted = new AiKeyStore(file, new InsecureTestVault());
    expect(await restarted.state()).toBe('stored');
    expect(await restarted.get()).toBe(KEY);
  });

  it('removes the key', async () => {
    const store = new AiKeyStore(file, new InsecureTestVault());
    await store.set(KEY);
    expect(await store.set(null)).toBe('none');
    expect(await new AiKeyStore(file, new InsecureTestVault()).get()).toBeNull();
  });

  it.each(['insecure', 'unavailable'] as const)('refuses to store a key when the vault is %s and offers no key', async (availability) => {
    const store = new AiKeyStore(file, new InsecureTestVault(availability));
    expect(await store.state()).toBe('vault-unavailable');
    await expect(store.set(KEY)).rejects.toThrow();
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.get()).toBeNull();
  });

  it('treats an unreadable key file as no key and logs without the content', async () => {
    await writeFile(file, '{"version":1,"sealed":"bm90LXNlYWxlZA=="}');
    const logger = new RecordingLogger();
    const store = new AiKeyStore(file, new InsecureTestVault(), logger);
    expect(await store.get()).toBeNull();
    expect(await store.state()).toBe('none');
    expect(logger.errors).toHaveLength(1);
  });
});
