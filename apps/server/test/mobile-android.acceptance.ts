import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { encodePairingToken } from '@codevo-whisper/protocol';
import { startHarness } from './support/server-harness';
import { startFakeSttServer } from './support/fake-stt-server';
import { openPairingWindow } from './support/admin';
import { startMobileRuntimePeer } from './support/mobile-runtime-peer';

const exec = promisify(execFile);
it('proves packaged Hermes gateway and cold IME from another app', async () => {
  const serial = process.env.ANDROID_SERIAL;
  if (serial === undefined || !/^emulator-\d+$/.test(serial)) throw new Error('Android acceptance requires an explicit emulator ANDROID_SERIAL; it clears app data');
  const data = await mkdtemp(join(tmpdir(), 'codevo-android-'));
  await chmod(data, 0o700);
  const fake = await startFakeSttServer({ delayMs: 1200, respond: () => ({ status: 200, body: { text: 'Ahoj z mobilu' } }) });
  const peer = await startMobileRuntimePeer();
  const server = await startHarness(data, fake.url, {}, { publicEndpoint: 'ws://10.0.2.2:18787', port: 18787 });
  const adb = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb';
  const run = (...args: string[]) => exec(adb, ['-s', serial, ...args], { timeout: 180_000, maxBuffer: 2_000_000 });
  const android = resolve(import.meta.dirname, '../../mobile/android');
  try {
    await run('install', '-r', join(android, 'app/build/outputs/apk/verification/app-verification.apk'));
    await run('install', '-r', join(android, 'fixture/build/outputs/apk/debug/fixture-debug.apk'));
    await run('install', '-r', join(android, 'fixture/build/outputs/apk/androidTest/debug/fixture-debug-androidTest.apk'));
    await run('shell', 'pm', 'clear', 'com.codevo.mobile');
    await run('install', '-r', join(android, 'app/build/outputs/apk/androidTest/verification/app-verification-androidTest.apk'));
    const vaultTest = await run('shell', 'am', 'instrument', '-w', '-e', 'class', 'com.codevo.VaultTest', 'com.codevo.mobile.test/androidx.test.runner.AndroidJUnitRunner');
    expect(vaultTest.stdout).toContain('OK (1 test)');
    await run('shell', 'settings', 'put', 'system', 'screen_off_timeout', '600000');
    await run('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1');
    const window = await openPairingWindow(server.config.adminSocket, 120_000);
    const tokenFile = join(data, 'token');
    await writeFile(tokenFile, encodePairingToken(window.token), { mode: 0o600 });
    await run('push', tokenFile, '/data/local/tmp/codevo-pair-token');
    await rm(tokenFile);
    const runtimeFile = join(data, 'runtime-token');
    await writeFile(runtimeFile, peer.token, { mode: 0o600 });
    await run('push', runtimeFile, '/data/local/tmp/codevo-runtime-token');
    await run('shell', 'chmod', '600', '/data/local/tmp/codevo-runtime-token', '/data/local/tmp/codevo-pair-token');
    await rm(runtimeFile);
    const approval = (async () => {
      const event = await window.admin.next();
      expect(event).toMatchObject({ event: 'request', deviceName: 'Android phone' });
      window.admin.send({ decision: 'approve' });
      await window.admin.next();
      window.admin.close();
    })();
    const test = await run('shell', 'am', 'instrument', '-w', '-e', 'class', 'com.codevo.fixture.KeyboardTest', 'com.codevo.fixture.test/androidx.test.runner.AndroidJUnitRunner');
    await approval;
    expect(test.stdout).toContain('OK (2 tests)');
    expect(fake.requests.some((request) => request.language === 'sk')).toBe(true);
    expect(fake.requests.length).toBeGreaterThanOrEqual(2);
    expect(peer.stats).toMatchObject({ rejected: 1, sessions: 3, errors: 1, malformed: 1, pausedAudio: 0 });
    expect(peer.stats.resumedAudio).toBeGreaterThan(0);
  } finally {
    await run('shell', 'rm', '-f', '/data/local/tmp/codevo-pair-token', '/data/local/tmp/codevo-runtime-token');
    await peer.close();
    await server.close();
    await fake.close();
    await rm(data, { recursive: true, force: true });
  }
}, 180_000);
