import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { excerpt, trayMenuTemplate, type TrayMenuActions, type TrayMenuModel } from '../src/main/tray/tray-menu-template';

const MODEL: TrayMenuModel = {
  status: 'Pripravené · Pravý ⌃ Control',
  lastTranscript: null,
  paused: false,
  devices: [
    { deviceId: 'built-in', label: 'MacBook Pro Microphone', isBluetooth: false, isDefault: false },
    { deviceId: 'usb', label: 'Shure MV7', isBluetooth: false, isDefault: false },
  ],
  microphones: [],
  languages: { mode: 'auto', selected: ['sk', 'cs', 'en'] },
  autoLanguageAllowed: true,
  readyUpdate: null,
  installingUpdate: false,
  updateCheckable: true,
  retryable: false,
};

function recordingActions(): { actions: TrayMenuActions; calls: string[] } {
  const calls: string[] = [];
  const actions: TrayMenuActions = {
    copyLast: () => calls.push('copy-last'),
    pasteLast: () => calls.push('paste-last'),
    togglePause: () => calls.push('toggle-pause'),
    chooseMicrophone: (microphone) => calls.push(`microphone:${microphone?.deviceId ?? 'default'}`),
    chooseLanguageMode: (mode) => calls.push(`language-mode:${mode}`),
    editLanguages: () => calls.push('edit-languages'),
    openApp: () => calls.push('open-app'),
    openSettings: () => calls.push('open-settings'),
    quit: () => calls.push('quit'),
    installUpdate: () => calls.push('install-update'),
    checkForUpdates: () => calls.push('check-for-updates'),
    retry: () => calls.push('retry'),
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
      'Skúsiť znova',
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
      'Skontrolovať aktualizácie',
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
    expect(labels(filled)[4]).toBe('Ahoj Peter, pozrel som si ten pull request a vy…');
    expect(item(filled, 'Vložiť posledný prepis')).toMatchObject({ enabled: true, accelerator: 'Control+Command+V', registerAccelerator: false });
    click(item(filled, 'Kopírovať posledné diktovanie'));
    click(item(filled, 'Vložiť posledný prepis'));
    expect(calls).toEqual(['copy-last', 'paste-last']);
  });

  it('enables Skúsiť znova only while a failed recording is held', () => {
    const { actions, calls } = recordingActions();

    expect(item(trayMenuTemplate(MODEL, actions), 'Skúsiť znova').enabled).toBe(false);
    const held = item(trayMenuTemplate({ ...MODEL, retryable: true }, actions), 'Skúsiť znova');
    expect(held.enabled).toBe(true);
    click(held);
    expect(calls).toEqual(['retry']);
  });

  it('offers Pokračovať while paused', () => {
    const { actions, calls } = recordingActions();
    const items = trayMenuTemplate({ ...MODEL, paused: true }, actions);

    click(item(items, 'Pokračovať'));

    expect(labels(items)).not.toContain('Pozastaviť diktovanie');
    expect(calls).toEqual(['toggle-pause']);
  });

  it('lists the system default and every microphone and marks the one recording uses', () => {
    const { actions, calls } = recordingActions();
    const list = [{ deviceId: 'airpods', label: 'AirPods Pro' }, { deviceId: 'usb', label: 'Shure MV7' }, { deviceId: 'built-in', label: 'MacBook Pro Microphone' }];
    const microphones = submenu(trayMenuTemplate({ ...MODEL, microphones: list }, actions), 'Mikrofón');

    expect(labels(microphones)).toEqual(['Systémový predvolený', '---', 'MacBook Pro Microphone', 'Shure MV7', 'AirPods Pro (nepripojený)']);
    expect(microphones.filter((entry) => entry.checked).map((entry) => entry.label)).toEqual(['Shure MV7']);
    click(item(microphones, 'Systémový predvolený'));
    click(item(microphones, 'MacBook Pro Microphone'));
    expect(calls).toEqual(['microphone:default', 'microphone:built-in']);
  });

  it('marks the system default when no listed microphone is connected and keeps the first one visible', () => {
    const { actions } = recordingActions();
    const microphones = submenu(trayMenuTemplate({ ...MODEL, microphones: [{ deviceId: 'airpods', label: 'AirPods Pro' }] }, actions), 'Mikrofón');

    expect(item(microphones, 'AirPods Pro (nepripojený)')).toMatchObject({ checked: false, enabled: false });
    expect(item(microphones, 'Systémový predvolený').checked).toBe(true);
  });

  it('marks a listed microphone that reconnected under a new id', () => {
    const { actions } = recordingActions();
    const microphones = submenu(trayMenuTemplate({ ...MODEL, microphones: [{ deviceId: 'usb-old', label: 'Shure MV7' }] }, actions), 'Mikrofón');

    expect(microphones.filter((entry) => entry.checked).map((entry) => entry.label)).toEqual(['Shure MV7']);
    expect(labels(microphones)).not.toContain('Shure MV7 (nepripojený)');
  });

  it('switches between automatic and the selected languages and opens the language settings', () => {
    const { actions, calls } = recordingActions();
    const languages = submenu(trayMenuTemplate(MODEL, actions), 'Jazyk');

    expect(labels(languages)).toEqual(['Automaticky', 'Zvolené: SK, CS, EN', '---', 'Upraviť jazyky…']);
    expect(item(languages, 'Automaticky')).toMatchObject({ type: 'radio', checked: true, enabled: true });
    expect(item(languages, 'Zvolené: SK, CS, EN')).toMatchObject({ type: 'radio', checked: false });
    click(item(languages, 'Zvolené: SK, CS, EN'));
    click(item(languages, 'Automaticky'));
    click(item(languages, 'Upraviť jazyky…'));
    expect(calls).toEqual(['language-mode:selected', 'language-mode:auto', 'edit-languages']);
  });

  it('marks the selected mode and disables Automaticky when the model needs languages', () => {
    const { actions } = recordingActions();
    const languages = submenu(trayMenuTemplate({ ...MODEL, languages: { mode: 'selected', selected: ['cs'] }, autoLanguageAllowed: false }, actions), 'Jazyk');

    expect(item(languages, 'Zvolené: CS').checked).toBe(true);
    expect(item(languages, 'Automaticky')).toMatchObject({ checked: false, enabled: false });
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

describe('trayMenuTemplate with a downloaded update', () => {
  it('offers the restart into a downloaded update right after the status', () => {
    const { actions, calls } = recordingActions();
    const items = trayMenuTemplate({ ...MODEL, readyUpdate: '1.2.0' }, actions);

    expect(labels(items).slice(0, 5)).toEqual(['Pripravené · Pravý ⌃ Control', 'Reštartovať a aktualizovať na verziu 1.2.0', 'Skúsiť znova', '---', 'Posledné diktovanie']);
    click(item(items, 'Reštartovať a aktualizovať na verziu 1.2.0'));
    expect(calls).toEqual(['install-update']);
  });

  it('does not let the pause item resume dictation while the update installs', () => {
    const { actions } = recordingActions();
    const items = trayMenuTemplate({ ...MODEL, paused: true, installingUpdate: true }, actions);

    expect(item(items, 'Pokračovať')).toMatchObject({ enabled: false });
    expect(item(trayMenuTemplate({ ...MODEL, paused: true }, actions), 'Pokračovať').enabled).not.toBe(false);
  });
});

describe('trayMenuTemplate update check', () => {
  it('checks for updates from the tray', () => {
    const { actions, calls } = recordingActions();
    const check = item(trayMenuTemplate(MODEL, actions), 'Skontrolovať aktualizácie');

    expect(check.enabled).toBe(true);
    click(check);
    expect(calls).toEqual(['check-for-updates']);
  });

  it('disables the check when the updater cannot check now', () => {
    const { actions } = recordingActions();

    expect(item(trayMenuTemplate({ ...MODEL, updateCheckable: false }, actions), 'Skontrolovať aktualizácie').enabled).toBe(false);
  });
});
