import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';

type FakeMenu = { template: MenuItemConstructorOptions[] };

const trays = vi.hoisted(() => [] as Array<{ contextMenu: FakeMenu | null }>);

vi.mock('electron', () => ({
  nativeImage: { createEmpty: () => ({ addRepresentation: () => undefined, setTemplateImage: () => undefined }) },
  Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => ({ template }) },
  Tray: class {
    contextMenu: FakeMenu | null = null;
    constructor() {
      trays.push(this);
    }
    setToolTip(): void {}
    setImage(): void {}
    on(): void {}
    setContextMenu(menu: FakeMenu | null): void {
      this.contextMenu = menu;
    }
    popUpContextMenu(): void {}
    destroy(): void {}
  },
}));

const { TrayMenu } = await import('../src/main/tray/tray-menu');

function linuxTray() {
  let settings: Settings = { ...DEFAULT_SETTINGS, hotkey: { label: 'Pravý Ctrl' } as Settings['hotkey'] };
  const settingsListeners: Array<(next: Settings, previous: Settings) => void> = [];
  let paused = false;
  const tray = new TrayMenu({
    platform: 'linux',
    coordinator: {
      pasteLast: () => Promise.resolve(),
      copyLast: () => Promise.resolve(),
      pause: () => (paused = true),
      resume: () => (paused = false),
      isPaused: () => paused,
    } as never,
    capture: { listDevices: () => Promise.resolve([{ deviceId: 'usb', label: 'Shure MV7', isBluetooth: false, isDefault: false }]) },
    settings: {
      get: () => settings,
      update: (patch) => {
        const previous = settings;
        settings = { ...settings, ...patch };
        settingsListeners.forEach((listener) => listener(settings, previous));
        return Promise.resolve(settings);
      },
      onChange: (listener) => {
        settingsListeners.push(listener);
        return () => undefined;
      },
    },
    lastTranscript: { get: () => null, onChange: () => () => undefined },
    models: { activeLanguageHint: () => 'optional' } as never,
    updates: { status: () => ({ currentVersion: '0.2.1', mode: 'auto', phase: { kind: 'idle' } }) as never, install: () => Promise.resolve('restarting' as never), onChange: () => () => undefined },
    openApp: () => undefined,
    openSettings: () => undefined,
    quit: () => undefined,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
  tray.create();
  return tray;
}

function attachedMenu(): MenuItemConstructorOptions[] {
  const menu = trays.at(-1)?.contextMenu;
  if (!menu) {
    throw new Error('No context menu is attached to the tray');
  }
  return menu.template;
}

function submenu(label: string): MenuItemConstructorOptions[] {
  const found = attachedMenu().find((item) => item.label === label);
  return found?.submenu as MenuItemConstructorOptions[];
}

describe('TrayMenu on Linux', () => {
  it('attaches the menu with the status and microphones so the indicator can show it', async () => {
    linuxTray();
    expect(attachedMenu()[0]?.label).toBe('Pripravené · Pravý Ctrl');

    await vi.waitFor(() => expect(submenu('Mikrofón').map((item) => item.label)).toContain('Shure MV7'));
    expect(attachedMenu()[0]?.label).toBe('Pripravené · Pravý Ctrl');
  });

  it('re-attaches the menu when dictation state and settings change', async () => {
    const tray = linuxTray();
    await vi.waitFor(() => expect(trays.at(-1)?.contextMenu).not.toBeNull());

    tray.reflect({ kind: 'recording', elapsedMs: 0, level: 0, language: 'sk' });
    expect(attachedMenu()[0]?.label).toBe('Nahrávam…');

    submenu('Jazyk').find((item) => item.label === 'Čeština')?.click?.(undefined as never, undefined, undefined as never);
    await vi.waitFor(() => expect(submenu('Jazyk').find((item) => item.checked)?.label).toBe('Čeština'));
  });
});
