import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeInputHelper, type FakeInputHelperState } from '../src/main/helper/fake-input-helper';
import { HotkeyService } from '../src/main/hotkey/hotkey-service';
import { SettingsStore } from '../src/main/settings/settings-store';
import type { Settings } from '../src/shared/settings';
import { FakePowerEvents } from './fake-power-events';
import { RecordingLogger } from './recording-logger';

const FN = { keycode: 63, label: 'Fn / 🌐' } as const;
const RIGHT_CONTROL = { keycode: 62, label: 'Pravý ⌃ Control' } as const;

type Setup = {
  settings?: Partial<Settings>;
  helper?: Partial<FakeInputHelperState>;
  clock?: () => number;
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-hotkey-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

async function started(setup: Setup = {}) {
  const logger = new RecordingLogger();
  const settings = new SettingsStore(join(dir, 'settings.json'), logger);
  await settings.load();
  await settings.update({ hotkey: FN, mode: 'hold', ...setup.settings });
  const helper = new FakeInputHelper(setup.helper);
  const power = new FakePowerEvents();
  const service = new HotkeyService(helper, settings, power, setup.clock, logger);
  const events: string[] = [];
  service.onStart(() => events.push('start'));
  service.onStop((reason) => events.push(`stop:${reason}`));
  await service.start();
  return { settings, helper, power, service, events, logger };
}

describe('HotkeyService', () => {
  it.each([0, 299])('smart starts immediately and latches a %i ms press until the next down', async (duration) => {
    const { helper, events, service } = await started({ settings: { mode: 'smart' } });

    helper.pressKey('down', 63, 0);
    expect(events).toEqual(['start']);
    helper.pressKey('up', 63, duration);
    expect(events).toEqual(['start']);
    helper.pressKey('down', 63, 1_000);
    helper.pressKey('up', 63, 1_500);
    expect(events).toEqual(['start', 'stop:toggled']);
    helper.pressKey('down', 63, 2_000);
    expect(events).toEqual(['start', 'stop:toggled', 'start']);
    service.dispose();
  });

  it.each([300, 301])('smart releases a %i ms press using event timestamps', async (duration) => {
    let now = 1_000;
    const { helper, events } = await started({ settings: { mode: 'smart' }, clock: () => now });

    helper.pressKey('down', 63, 0);
    now += 10;
    helper.pressKey('up', 63, duration);

    expect(events).toEqual(['start', 'stop:released']);
  });

  it('smart ignores repeated downs without resetting the first press duration', async () => {
    const { helper, events } = await started({ settings: { mode: 'smart' } });

    helper.pressKey('down', 63, 0);
    helper.pressKey('down', 63, 250);
    expect(events).toEqual(['start']);
    helper.pressKey('up', 63, 300);

    expect(events).toEqual(['start', 'stop:released']);
  });

  it('smart waits for release without a classification timer and uses event time for a tap', async () => {
    vi.useFakeTimers();
    const { helper, events, service } = await started({ settings: { mode: 'smart' } });

    helper.pressKey('up', 63, 0);
    helper.pressKey('down', 63, 0);
    vi.advanceTimersByTime(10_000);
    expect(events).toEqual(['start']);
    helper.pressKey('up', 63, 299);
    expect(events).toEqual(['start']);
    helper.pressKey('down', 63, 400);
    expect(events).toEqual(['start', 'stop:toggled']);
    service.dispose();
  });

  it('smart can cancel synchronously on start and accept a fresh tap after the trailing up', async () => {
    const { helper, service, events } = await started({ settings: { mode: 'smart' } });
    const unsubscribe = service.onStart(() => service.cancel());

    helper.pressKey('down', 63, 0);
    helper.pressKey('up', 63, 299);
    expect(events).toEqual(['start', 'stop:cancelled']);
    unsubscribe();
    helper.pressKey('down', 63, 1_000);
    helper.pressKey('up', 63, 1_299);
    helper.pressKey('down', 63, 2_000);
    helper.pressKey('up', 63, 2_300);

    expect(events).toEqual(['start', 'stop:cancelled', 'start', 'stop:toggled']);
  });

  describe.each(['pressed', 'latched'])('smart %s resets', (phase) => {
    it.each(['cancel', 'pause', 'mode', 'hotkey', 'clear', 'lock', 'suspend', 'input-lost', 'limit', 'dispose'] as const)('%s clears the gesture and ignores trailing release', async (reset) => {
      const { helper, service, settings, power, events } = await started({ settings: { mode: 'smart' } });
      helper.pressKey('down', 63, 0);
      if (phase === 'latched') {
        helper.pressKey('up', 63, 299);
      }
      let reason = 'cancelled';
      switch (reset) {
        case 'cancel': service.cancel(); break;
        case 'pause': service.pause(); service.resume(); break;
        case 'mode': await settings.update({ mode: 'hold' }); break;
        case 'hotkey': await settings.update({ hotkey: RIGHT_CONTROL }); break;
        case 'clear': await settings.update({ hotkey: null }); break;
        case 'lock': power.emit('lock-screen'); reason = 'lock'; break;
        case 'suspend': power.emit('suspend'); reason = 'suspend'; break;
        case 'input-lost': helper.loseInput('helper-died'); reason = 'input-lost'; break;
        case 'limit': service.stopForLimit(); reason = 'max-duration'; break;
        case 'dispose': service.dispose(); break;
      }
      helper.pressKey('up', 63, 301);
      service.cancel();
      expect(events).toEqual(['start', `stop:${reason}`]);
      await settings.update({ hotkey: FN, mode: 'smart' });
      helper.pressKey('down', 63, 1_000);
      expect(events).toEqual(reset === 'dispose' ? ['start', `stop:${reason}`] : ['start', `stop:${reason}`, 'start']);
      service.dispose();
    });

    it('retains the original ten-minute deadline', async () => {
      vi.useFakeTimers();
      const { helper, events } = await started({ settings: { mode: 'smart' } });
      helper.pressKey('down', 63, 0);
      vi.advanceTimersByTime(599_999);
      if (phase === 'latched') {
        helper.pressKey('up', 63, 299);
      }
      expect(events).toEqual(['start']);
      vi.advanceTimersByTime(1);
      helper.pressKey('up', 63, 300);
      expect(events).toEqual(['start', 'stop:max-duration']);
    });

    it('consumes the next key event when the deadline timer is late', async () => {
      let now = 0;
      const { helper, events, service } = await started({ settings: { mode: 'smart' }, clock: () => now });
      helper.pressKey('down', 63, 0);
      if (phase === 'latched') {
        helper.pressKey('up', 63, 299);
      }
      now = 600_000;
      helper.pressKey(phase === 'latched' ? 'down' : 'up', 63, 600_000);
      helper.pressKey('up', 63, 600_001);
      expect(events).toEqual(['start', 'stop:max-duration']);
      helper.pressKey('down', 63, 601_000);
      expect(events).toEqual(['start', 'stop:max-duration', 'start']);
      service.dispose();
    });

    it('keeps recording across unrelated settings changes', async () => {
      const { helper, events, settings, service } = await started({ settings: { mode: 'smart' } });
      helper.pressKey('down', 63, 0);
      if (phase === 'latched') {
        helper.pressKey('up', 63, 299);
      }
      await settings.update({ language: 'en' });
      expect(events).toEqual(['start']);
      service.dispose();
    });
  });

  it('hold mode starts on down and stops on up', async () => {
    const { helper, events } = await started();

    helper.pressKey('down', 63);
    const afterDown = [...events];
    helper.pressKey('up', 63);

    expect(helper.listening).toEqual([63]);
    expect(afterDown).toEqual(['start']);
    expect(events).toEqual(['start', 'stop:released']);
  });

  it('toggle mode stops on second down', async () => {
    const { helper, events } = await started({ settings: { mode: 'toggle' } });

    helper.pressKey('down', 63);
    helper.pressKey('up', 63);
    const afterFirstPress = [...events];
    helper.pressKey('down', 63);
    helper.pressKey('up', 63);

    expect(afterFirstPress).toEqual(['start']);
    expect(events).toEqual(['start', 'stop:toggled']);
  });

  it('ignores keys other than the configured one', async () => {
    const { helper, events } = await started();
    await helper.listen([61, 63]);

    helper.pressKey('down', 61);
    helper.pressKey('up', 61);

    expect(events).toEqual([]);
  });

  it('stops on lock and ignores the late up', async () => {
    const { helper, power, events } = await started();

    helper.pressKey('down', 63);
    power.emit('lock-screen');
    helper.pressKey('up', 63);
    const afterLateUp = [...events];
    helper.pressKey('down', 63);

    expect(afterLateUp).toEqual(['start', 'stop:lock']);
    expect(events).toEqual(['start', 'stop:lock', 'start']);
  });

  it('stops on suspend and stops watching power events once idle', async () => {
    const { helper, power, events } = await started();

    helper.pressKey('down', 63);
    power.emit('suspend');
    power.emit('suspend');
    helper.pressKey('up', 63);

    expect(events).toEqual(['start', 'stop:suspend']);
    expect(power.listenerCount()).toBe(0);
  });

  it('stops on lost input events and ignores the late up', async () => {
    const { helper, events } = await started();

    helper.pressKey('down', 63);
    helper.loseInput('tap-reenabled');
    helper.pressKey('up', 63);
    helper.pressKey('down', 63);
    helper.loseInput('helper-restarted');
    helper.pressKey('up', 63);

    expect(events).toEqual(['start', 'stop:input-lost', 'start', 'stop:input-lost']);
  });

  it('stops at the 10 minute max duration', async () => {
    vi.useFakeTimers();
    const { helper, events } = await started();

    helper.pressKey('down', 63);
    vi.advanceTimersByTime(599_999);
    const beforeLimit = [...events];
    vi.advanceTimersByTime(1);
    helper.pressKey('up', 63);

    expect(beforeLimit).toEqual(['start']);
    expect(events).toEqual(['start', 'stop:max-duration']);
  });

  it('stops at max duration on the next key event when the timer is late', async () => {
    let now = 1_000;
    const { helper, events } = await started({ clock: () => now });

    helper.pressKey('down', 63);
    now += 599_999;
    helper.pressKey('up', 63);
    expect(events).toEqual(['start', 'stop:released']);

    helper.pressKey('down', 63);
    now += 600_000;
    helper.pressKey('up', 63);

    expect(events).toEqual(['start', 'stop:released', 'start', 'stop:max-duration']);
  });

  it('keeps a toggle session running past 2 minutes until the 10 minute limit', async () => {
    vi.useFakeTimers();
    const { helper, events } = await started({ settings: { mode: 'toggle' } });

    helper.pressKey('down', 63);
    helper.pressKey('up', 63);
    vi.advanceTimersByTime(120_000);
    const afterTwoMinutes = [...events];
    vi.advanceTimersByTime(480_000);

    expect(afterTwoMinutes).toEqual(['start']);
    expect(events).toEqual(['start', 'stop:max-duration']);
  });

  it('uses the new key after a settings change without restart', async () => {
    const { settings, helper, events } = await started();

    await settings.update({ hotkey: RIGHT_CONTROL });
    helper.pressKey('down', 62);
    helper.pressKey('up', 62);

    expect(helper.listening).toEqual([62]);
    expect(events).toEqual(['start', 'stop:released']);
  });

  it('cancels an active session when the hotkey or mode changes', async () => {
    const { settings, helper, events } = await started();

    helper.pressKey('down', 63);
    await settings.update({ hotkey: RIGHT_CONTROL });
    helper.pressKey('down', 62);
    await settings.update({ mode: 'toggle' });
    await settings.update({ language: 'en' });

    expect(events).toEqual(['start', 'stop:cancelled', 'start', 'stop:cancelled']);
  });

  it('does nothing while paused', async () => {
    const { service, helper, events } = await started();

    service.pause();
    helper.pressKey('down', 63);
    helper.pressKey('up', 63);
    const whilePaused = [...events];
    service.resume();
    helper.pressKey('down', 63);
    service.pause();
    helper.pressKey('up', 63);

    expect(whilePaused).toEqual([]);
    expect(events).toEqual(['start', 'stop:cancelled']);
  });

  it('stops with max-duration when the recording limit is reached', async () => {
    const { service, helper, events } = await started();

    service.stopForLimit();
    helper.pressKey('down', 63);
    service.stopForLimit();
    helper.pressKey('up', 63);

    expect(events).toEqual(['start', 'stop:max-duration']);
  });

  it('cancel ends the active session so the next press starts a new one in toggle mode', async () => {
    const { service, helper, events } = await started({ settings: { mode: 'toggle' } });

    helper.pressKey('down', 63);
    service.cancel();
    service.cancel();
    helper.pressKey('down', 63);

    expect(events).toEqual(['start', 'stop:cancelled', 'start']);
  });

  it('stops a dead helper session immediately instead of at the limit', async () => {
    const { helper, events } = await started();

    helper.pressKey('down', 63);
    helper.loseInput('helper-died');

    expect(events).toEqual(['start', 'stop:input-lost']);
  });

  it('dispose cancels the active session and stops reacting to keys and settings', async () => {
    const { service, settings, helper, power, events } = await started();

    helper.pressKey('down', 63);
    service.dispose();
    helper.pressKey('up', 63);
    helper.pressKey('down', 63);
    await settings.update({ hotkey: RIGHT_CONTROL });

    expect(events).toEqual(['start', 'stop:cancelled']);
    expect(helper.listening).toEqual([63]);
    expect(power.listenerCount()).toBe(0);
  });

  it('does nothing while no hotkey is configured', async () => {
    const { helper, events } = await started({ settings: { hotkey: null } });
    const listened = [...helper.listening];
    await helper.listen([63]);

    helper.pressKey('down', 63);
    helper.pressKey('up', 63);

    expect(listened).toEqual([]);
    expect(events).toEqual([]);
  });

  it('stays idle and logs when input monitoring is not granted', async () => {
    const { settings, helper, events, logger } = await started({
      helper: { permissions: { listen: false, post: true, accessibility: true } },
    });

    await settings.update({ hotkey: RIGHT_CONTROL });
    helper.pressKey('down', 62);

    expect(helper.listening).toEqual([]);
    expect(events).toEqual([]);
    expect(logger.errors.map((entry) => entry.message)).toEqual(['Input Monitoring is not granted, the hotkey stays idle']);
  });

  it('is not armed when listening to a changed hotkey fails', async () => {
    const { settings, helper, service, logger } = await started();
    expect(service.isArmed()).toBe(true);

    helper.listenFails = true;
    await settings.update({ hotkey: RIGHT_CONTROL });

    await vi.waitFor(() => expect(logger.errors.length).toBeGreaterThan(0));
    expect(service.isArmed()).toBe(false);
  });

  it('is not armed when the first listen fails', async () => {
    const helper = new FakeInputHelper();
    helper.listenFails = true;
    const settings = new SettingsStore(join(dir, 'settings.json'), new RecordingLogger());
    await settings.load();
    await settings.update({ hotkey: FN });
    const service = new HotkeyService(helper, settings, new FakePowerEvents(), undefined, new RecordingLogger());

    await expect(service.start()).rejects.toThrow('tap-create-failed');
    expect(service.isArmed()).toBe(false);
  });
});
