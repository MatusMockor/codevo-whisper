import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { HelperProcess } from '../src/main/helper/helper-process';
import { RecordingLogger } from './recording-logger';

const fixture = fileURLToPath(new URL('./fixtures/protocol-helper.js', import.meta.url));
let helper: HelperProcess | null = null;
const execFile = promisify(execFileCallback);

afterEach(async () => {
  await helper?.stop();
  helper = null;
  if (process.platform !== 'linux' || process.env['CW_TEST_SYSTEMD'] !== '1') return;
  const { stdout } = await execFile('systemctl', ['--user', 'list-units', '--all', '--plain', '--no-legend', `codevo-input-helper-${process.pid}-*.service`]);
  expect(stdout.trim()).toBe('');
});

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describe.runIf(process.platform === 'linux' && process.env['CW_TEST_SYSTEMD'] === '1')('managed Linux helper', () => {
  function create(args: string[] = []) {
    helper = new HelperProcess({ kind: 'user-service', file: process.execPath, args: [fixture, ...args] }, { logger: new RecordingLogger(), timeoutMs: 5000 });
    return helper;
  }

  it('starts in a user service and exits without leaving a helper after EOF', async () => {
    const process = create();
    await process.start();
    const ping = await process.request('ping');
    expect(typeof ping['pid']).toBe('number');
    if (typeof ping['pid'] !== 'number') throw new Error('missing helper pid');
    const pid = ping['pid'];
    expect(await readFile(`/proc/${pid}/cgroup`, 'utf8')).toContain('codevo-input-helper-');
    await process.stop();
    await expect.poll(() => alive(pid)).toBe(false);
  });

  it('uses the launching desktop session instead of the manager display', async () => {
    const display = process.env['DISPLAY'];
    const wayland = process.env['WAYLAND_DISPLAY'];
    process.env['DISPLAY'] = 'codevo-test-session';
    delete process.env['WAYLAND_DISPLAY'];
    try {
      const channel = create();
      await channel.start();
      expect(await channel.request('session-env')).toMatchObject({ display: 'codevo-test-session', wayland: null });
    } finally {
      if (display === undefined) delete process.env['DISPLAY'];
      if (display !== undefined) process.env['DISPLAY'] = display;
      if (wayland !== undefined) process.env['WAYLAND_DISPLAY'] = wayland;
    }
  });

  it('terminates a helper that ignores EOF', async () => {
    const process = create(['--ignore-eof']);
    await process.start();
    const ping = await process.request('ping');
    if (typeof ping['pid'] !== 'number') throw new Error('missing helper pid');
    const pid = ping['pid'];
    await process.stop();
    await expect.poll(() => alive(pid)).toBe(false);
  });

  it('quits during service startup without retaining the pending helper', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cw-managed-start-'));
    const pidFile = join(directory, 'pid');
    const channel = create(['--ready-delay=2000', `--started-pid-file=${pidFile}`]);
    const started = expect(channel.start()).rejects.toThrow('helper-exited');
    try {
      await expect.poll(async () => {
        try { await access(pidFile); return true; } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
          throw error;
        }
      }).toBe(true);
      const pid = Number(await readFile(pidFile, 'utf8'));
      await channel.stop();
      await started;
      expect(alive(pid)).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('restarts once after a crash, then stops both service generations', async () => {
    const process = create();
    await process.start();
    const first = await process.request('ping');
    await expect(process.request('crash')).rejects.toThrow('helper-exited');
    const second = await process.request('ping');
    expect(second['pid']).not.toBe(first['pid']);
    await process.stop();
    if (typeof first['pid'] !== 'number' || typeof second['pid'] !== 'number') throw new Error('missing helper pid');
    const firstPid = first['pid'];
    const secondPid = second['pid'];
    await expect.poll(() => alive(firstPid) || alive(secondPid)).toBe(false);
  });

  it('retires the old service before replacing an abruptly killed runner', async () => {
    const channel = create(['--ignore-eof']);
    await channel.start();
    const first = await channel.request('ping');
    if (typeof first['pid'] !== 'number') throw new Error('missing helper pid');
    const firstPid = first['pid'];
    const group = await readFile(`/proc/${firstPid}/cgroup`, 'utf8');
    const unit = group.trim().split('/').at(-1);
    if (unit === undefined) throw new Error('missing unit');
    const children = (await readFile(`/proc/self/task/${process.pid}/children`, 'utf8')).trim().split(/\s+/);
    let runner: number | null = null;
    for (const pid of children) {
      try {
        const command = await readFile(`/proc/${pid}/cmdline`, 'utf8');
        if (command.includes('systemd-run') && command.includes(unit)) runner = Number(pid);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    if (runner === null) throw new Error('missing service runner');
    const restarted = new Promise<void>((resolve) => channel.onRestart(resolve));
    process.kill(runner, 'SIGKILL');
    await restarted;
    const second = await channel.request('ping');
    expect(second['pid']).not.toBe(firstPid);
    expect(alive(firstPid)).toBe(false);
    await channel.stop();
    if (typeof second['pid'] !== 'number') throw new Error('missing helper pid');
    expect(alive(second['pid'])).toBe(false);
  });

  it('reports a missing executable without retaining a service', async () => {
    helper = new HelperProcess({ kind: 'user-service', file: '/nonexistent-codevo-helper', args: [] }, { logger: new RecordingLogger(), timeoutMs: 5000 });
    await expect(helper.start()).rejects.toThrow('helper-exited');
    await helper.stop();
  });
});
