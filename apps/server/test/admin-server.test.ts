import { chmod, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/app';
import { startFakeSttServer, type FakeSttServer } from './support/fake-stt-server';
import { testConfig } from './support/server-harness';
import { createTempDir } from './support/temp-dir';

let dir: Awaited<ReturnType<typeof createTempDir>>;
let fake: FakeSttServer;
let server: RunningServer | undefined;

beforeEach(async () => {
  dir = await createTempDir();
  fake = await startFakeSttServer();
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await fake.close();
  await dir.remove();
});

function configWithSocket(adminSocket: string): ReturnType<typeof testConfig> {
  return { ...testConfig(join(dir.path, 'data'), fake.url), adminSocket };
}

describe('admin socket', () => {
  it('creates the socket directory with mode 0700 and the socket with mode 0600', async () => {
    const socketDir = join(dir.path, 'run', 'codevo-whisper');
    server = await startServer(configWithSocket(join(socketDir, 'admin.sock')));

    expect((await stat(socketDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(socketDir, 'admin.sock'))).mode & 0o777).toBe(0o600);
  });

  it('refuses a socket directory that group or others can access', async () => {
    const socketDir = join(dir.path, 'shared');
    await mkdir(socketDir);
    await chmod(socketDir, 0o777);

    await expect(startServer(configWithSocket(join(socketDir, 'admin.sock')))).rejects.toThrow(/admin socket directory/);
  });

  it('refuses a socket directory owned by another user', async () => {
    await expect(startServer(configWithSocket('/usr/codevo-whisper-admin.sock'))).rejects.toThrow(/admin socket directory/);
  });
});
