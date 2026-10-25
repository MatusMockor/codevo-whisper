import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { excerpt, trayMenuTemplate, type TrayMenuActions, type TrayMenuModel } from '../src/main/tray/tray-menu-template';

const MODEL: TrayMenuModel = {
  status: 'Pripravené · Pravý ⌃ Control',
  lastTranscript: null,
  paused: false,
  devices: [
    { deviceId: 'built-in', label: 'MacBook Pro Microphone', isBluetooth: false },
    { deviceId: 'usb', label: 'Shure MV7', isBluetooth: false },
  ],
  microphone: { deviceId: null, label: null },
  language: 'sk',
  autoLanguageAllowed: true,
};

function recordingActions(): { actions: TrayMenuActions; calls: string[] } {
  const calls: string[] = [];
  const actions: TrayMenuActions = {
    copyLast: () => calls.push('copy-last'),
    pasteLast: () => calls.push('paste-last'),
    togglePause: () => calls.push('toggle-pause'),
    chooseMicrophone: (microphone) => calls.push(`microphone:${microphone.deviceId ?? 'default'}`),
    chooseLanguage: (language) => calls.push(`language:${language}`),
    openApp: () => calls.push('open-app'),
    openSettings: () => calls.push('open-settings'),
    quit: () => calls.push('quit'),
  };
  return { actions, calls };
}

function labels(items: readonly MenuItemConstructorOptions[]): string[] {
  return items.map((item) => (item.type === 'separator' ? '---' : (item.label ?? '')));
}

function item(items: readonly MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const found = items.find((candidate) => candidate.label === label);
  expect(found, label).toBeDefined();
  return found ?? {};
}

function submenu(items: readonly MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const entries = item(items, label).submenu;
  expect(Array.isArray(entries)).toBe(true);
  return entries as MenuItemConstructorOptions[];
}

function click(entry: MenuItemConstructorOptions): void {
  expect(entry.click).toBeTypeOf('function');
  (entry.click as () => void)();
}

describe('trayMenuTemplate', () => {
  it('lists the status, last transcript actions, controls and app items in order', () => {
    const { actions } = recordingActions();

    expect(labels(trayMenuTemplate(MODEL, actions))).toEqual([
      'Pripravené · Pravý ⌃ Control',
      '---',
      'Posledné diktovanie',
      'Kopírovať posledné diktovanie',
      'Vložiť posledný prepis',
      '---',
      'Pozastaviť diktovanie',
      'Mikrofón',
      'Jazyk',
      '---',
      'Otvoriť Codevo Whisper',
      'Nastavenia…',
      '---',
      'Ukončiť Codevo Whisper',
    ]);
  });

  it('disables the transcript items until there is a transcript and shows its excerpt', () => {
    const { actions, calls } = recordingActions();
    const empty = trayMenuTemplate(MODEL, actions);
    const filled = trayMenuTemplate({ ...MODEL, lastTranscript: 'Ahoj Peter,\npozrel som si ten pull request a vyzerá to dobre' }, actions);

    expect(item(empty, 'Kopírovať posledné diktovanie').enabled).toBe(false);
    expect(item(empty, 'Vložiť posledný prepis').enabled).toBe(false);
    expect(labels(filled)[3]).toBe('Ahoj Peter, pozrel som si ten pull request a vy…');
    expect(item(filled, 'Vložiť posledný prepis')).toMatchObject({ enabled: true, accelerator: 'Control+Command+V', registerAccelerator: false });
    click(item(filled, 'Kopírovať posledné diktovanie'));
    click(item(filled, 'Vložiť posledný prepis'));
    expect(calls).toEqual(['copy-last', 'paste-last']);
  });

  it('offers Pokračovať while paused', () => {
    const { actions, calls } = recordingActions();
    const items = trayMenuTemplate({ ...MODEL, paused: true }, actions);

    click(item(items, 'Pokračovať'));

    expect(labels(items)).not.toContain('Pozastaviť diktovanie');
    expect(calls).toEqual(['toggle-pause']);
  });

  it('lists the system default and every microphone and marks the chosen one', () => {
    const { actions, calls } = recordingActions();
    const microphones = submenu(trayMenuTemplate({ ...MODEL, microphone: { deviceId: 'usb', label: 'Shure MV7' } }, actions), 'Mikrofón');

    expect(labels(microphones)).toEqual(['Systémový predvolený', '---', 'MacBook Pro Microphone', 'Shure MV7']);
    expect(microphones.filter((entry) => entry.checked).map((entry) => entry.label)).toEqual(['Shure MV7']);
    click(item(microphones, 'Systémový predvolený'));
    click(item(microphones, 'MacBook Pro Microphone'));
    expect(calls).toEqual(['microphone:default', 'microphone:built-in']);
  });

  it('keeps an unplugged chosen microphone visible as not connected', () => {
    const { actions } = recordingActions();
    const microphones = submenu(trayMenuTemplate({ ...MODEL, microphone: { deviceId: 'airpods', label: 'AirPods Pro' } }, actions), 'Mikrofón');

    expect(item(microphones, 'AirPods Pro (nepripojený)')).toMatchObject({ checked: true, enabled: false });
    expect(item(microphones, 'Systémový predvolený').checked).toBe(false);
  });

  it('switches the language and disables Automaticky when the model needs a language', () => {
    const { actions, calls } = recordingActions();
    const languages = submenu(trayMenuTemplate({ ...MODEL, language: 'cs', autoLanguageAllowed: false }, actions), 'Jazyk');

    expect(labels(languages)).toEqual(['Slovenčina', 'Čeština', 'Angličtina', 'Automaticky']);
    expect(item(languages, 'Čeština').checked).toBe(true);
    expect(item(languages, 'Automaticky').enabled).toBe(false);
    click(item(languages, 'Angličtina'));
    expect(calls).toEqual(['language:en']);
  });

  it('opens the app, the settings and quits', () => {
    const { actions, calls } = recordingActions();
    const items = trayMenuTemplate(MODEL, actions);

    click(item(items, 'Otvoriť Codevo Whisper'));
    click(item(items, 'Nastavenia…'));
    click(item(items, 'Ukončiť Codevo Whisper'));

    expect(calls).toEqual(['open-app', 'open-settings', 'quit']);
  });
});

describe('excerpt', () => {
  it('keeps short text and shortens long text with an ellipsis', () => {
    expect(excerpt('  krátky   text ')).toBe('krátky text');
    expect(excerpt('a'.repeat(60))).toHaveLength(48);
  });
});
