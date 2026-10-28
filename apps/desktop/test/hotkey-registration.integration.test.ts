import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HelperProcessInputHelper } from '../src/main/helper/helper-process-input-helper';
import { HotkeyService } from '../src/main/hotkey/hotkey-service';
import { SettingsStore } from '../src/main/settings/settings-store';
import { FakePowerEvents } from './fake-power-events';
import { protocolHelper } from './protocol-helper';
import { RecordingLogger } from './recording-logger';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function prepared(flag = '--listen-with-edges') {
  const dir = await mkdtemp(join(tmpdir(), 'cw-registration-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const channel = protocolHelper(2000, [flag]);
  const helper = new HelperProcessInputHelper(channel);
  await helper.start();
  cleanups.push(() => helper.stop());
  const settings = new SettingsStore(join(dir, 'settings.json'), new RecordingLogger());
  await settings.load();
  await settings.update({ mode: 'smart', hotkey: { kind: 'key', keycode: 49, modifiers: ['control'], label: 'Ctrl+Space' } });
  const service = new HotkeyService(helper, settings, new FakePowerEvents(), undefined, new RecordingLogger());
  cleanups.push(() => service.dispose());
  const events: string[] = [];
  service.onStart(() => events.push('start'));
  service.onStop(reason => events.push(`stop:${reason}`));
  return { channel, helper, service, settings, events };
}

it('delivers same-chunk registration edges through the service on startup and restart with their original duration', async () => {
  const { channel, service, events } = await prepared();
  await service.start();
  expect(events).toEqual(['start', 'stop:released']);
  await expect(channel.request('crash')).rejects.toThrow('helper-exited');
  await expect.poll(() => events).toEqual(['start', 'stop:released', 'start', 'stop:released']);
});

it('discards same-chunk edges from a rejected registration', async () => {
  const { service, events } = await prepared('--listen-rejected-with-edges');
  await expect(service.start()).rejects.toThrow('listen-failed');
  expect(service.isArmed()).toBe(false);
  expect(events).toEqual([]);
});

it('discards superseded registration edges and delivers the replacement through the service', async () => {
  const { channel, service, settings, events } = await prepared();
  await channel.request('listen-defer-next');
  const first = service.start();
  await expect.poll(async () => (await channel.request('listen-state'))['listenId']).toBe(1);
  await settings.update({ hotkey: { kind: 'key', keycode: 2, modifiers: ['alt', 'shift'], label: 'Option+Shift+D' } });
  await channel.request('listen-finish');
  await first;
  await expect.poll(() => events).toEqual(['start', 'stop:released']);
  expect(service.isArmed()).toBe(true);
});
