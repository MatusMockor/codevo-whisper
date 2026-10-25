import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HelperMessage } from '../src/main/helper/helper-channel';
import type { HelperProcess } from '../src/main/helper/helper-process';
import { protocolHelper } from './protocol-helper';

let helper: HelperProcess | null = null;

afterEach(async () => {
  await helper?.stop();
  helper = null;
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function started(timeoutMs?: number): Promise<HelperProcess> {
  helper = protocolHelper(timeoutMs);
  await helper.start();
  return helper;
}

describe('HelperProcess', () => {
  it('matches responses by id', async () => {
    const process = await started();
    const events: HelperMessage[] = [];
    process.onEvent((event) => events.push(event));

    const [slow, fast] = await Promise.all([
      process.request('echo', { value: 'slow', delayMs: 80 }),
      process.request('echo', { value: 'fast', delayMs: 0 }),
      process.request('emit', { event: { event: 'shortcut', name: 'paste-last' } }),
    ]);

    expect(slow.value).toBe('slow');
    expect(fast.value).toBe('fast');
    expect(events).toEqual([{ event: 'shortcut', name: 'paste-last' }]);
  });

  it('times out a silent command', async () => {
    const process = await started(100);

    await expect(process.request('silent')).rejects.toThrow('helper-timeout:silent');
    expect((await process.request('ping')).pong).toBe(true);
  });

  it('rejects an error response', async () => {
    const process = await started();

    await expect(process.request('nonsense')).rejects.toThrow('helper-error:nonsense:unknown-command');
  });

  it('restarts once after a crash and then reports failure', async () => {
    const process = await started();
    const restarts: number[] = [];
    process.onRestart(() => restarts.push(1));
    const first = (await process.request('ping')).pid;

    await expect(process.request('crash')).rejects.toThrow('helper-exited');
    const second = (await process.request('ping')).pid;
    await expect(process.request('crash')).rejects.toThrow('helper-exited');

    expect(second).not.toBe(first);
    expect(restarts).toEqual([1]);
    await expect(process.request('ping')).rejects.toThrow('helper-unavailable');
  });

  it('rejects start when the helper dies before ready and does not restart it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cw-helper-'));
    helper = protocolHelper(2000, [`--exit-before-ready-once=${join(dir, 'launched')}`]);
    const restarts: number[] = [];
    helper.onRestart(() => restarts.push(1));

    await expect(helper.start()).rejects.toThrow('helper-exited');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(restarts).toEqual([]);
    await expect(helper.request('ping')).rejects.toThrow('helper-unavailable');
    await rm(dir, { recursive: true, force: true });
  });

  it('reuses the running helper on a second start instead of leaking it', async () => {
    const helperProcess = await started();
    const first = (await helperProcess.request('ping')).pid as number;

    await helperProcess.start();
    const second = (await helperProcess.request('ping')).pid as number;
    await helperProcess.stop();

    expect(second).toBe(first);
    await expect.poll(() => isAlive(first)).toBe(false);
  });

  it('gives up once when the restarted helper crashes again', async () => {
    const process = await started();
    const giveUps: number[] = [];
    process.onGiveUp(() => giveUps.push(1));

    await expect(process.request('crash')).rejects.toThrow('helper-exited');
    await process.request('ping');
    expect(giveUps).toEqual([]);
    await expect(process.request('crash')).rejects.toThrow('helper-exited');

    await expect.poll(() => giveUps).toEqual([1]);
  });

  it('gives up when the restart dies before it is ready', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cw-helper-'));
    const marker = join(dir, 'blocked');
    helper = protocolHelper(2000, [`--exit-before-ready-if-exists=${marker}`]);
    const giveUps: number[] = [];
    helper.onGiveUp(() => giveUps.push(1));
    await helper.start();
    await writeFile(marker, '');

    await expect(helper.request('crash')).rejects.toThrow('helper-exited');

    await expect.poll(() => giveUps).toEqual([1]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(giveUps).toEqual([1]);
    await expect(helper.request('ping')).rejects.toThrow('helper-unavailable');
    await rm(dir, { recursive: true, force: true });
  });

  it('does not give up after a deliberate stop', async () => {
    const process = await started();
    const giveUps: number[] = [];
    process.onGiveUp(() => giveUps.push(1));

    await process.stop();

    expect(giveUps).toEqual([]);
  });

  it('rejects requests after stop without restarting', async () => {
    const process = await started();
    const restarts: number[] = [];
    process.onRestart(() => restarts.push(1));

    await process.stop();

    await expect(process.request('ping')).rejects.toThrow('helper-unavailable');
    expect(restarts).toEqual([]);
  });
});
