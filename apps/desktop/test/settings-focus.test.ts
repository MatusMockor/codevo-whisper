import { describe, expect, it } from 'vitest';
import { focusHandlers } from '../src/main/ipc/focus-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import { SettingsFocus, type SettingsWindow } from '../src/main/windows/settings-focus';

type WindowCall = { kind: 'open'; page: string | undefined } | { kind: 'send'; event: string; payload: unknown };

function recordingWindow(calls: WindowCall[]): SettingsWindow {
  return {
    open: (page) => calls.push({ kind: 'open', page }),
    send: (event, payload) => calls.push({ kind: 'send', event, payload }),
  };
}

describe('SettingsFocus', () => {
  it('opens the settings page, announces the section and hands it out exactly once', async () => {
    const calls: WindowCall[] = [];
    const focus = new SettingsFocus(recordingWindow(calls));
    const handlers = focusHandlers({ settingsFocus: focus });

    expect(await handlers.takeSettingsFocus()).toBeNull();
    focus.reveal('local-model');

    expect(calls).toEqual([
      { kind: 'open', page: 'settings' },
      { kind: 'send', event: 'settings-focus-requested', payload: 'local-model' },
    ]);
    expect(await handlers.takeSettingsFocus()).toBe('local-model');
    expect(await handlers.takeSettingsFocus()).toBeNull();
    await expect(handlers.takeSettingsFocus('local-model')).rejects.toThrow(IpcValidationError);
  });
});
