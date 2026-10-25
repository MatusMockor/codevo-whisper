import type { MenuItemConstructorOptions } from 'electron';
import type { AudioDevice } from '../audio/device-resolver';
import type { Language, MicrophoneSetting } from '../../shared/settings';

export type TrayMenuModel = {
  status: string;
  lastTranscript: string | null;
  paused: boolean;
  devices: readonly AudioDevice[];
  microphone: MicrophoneSetting;
  language: Language;
  autoLanguageAllowed: boolean;
};

export type TrayMenuActions = {
  copyLast(): void;
  pasteLast(): void;
  togglePause(): void;
  chooseMicrophone(microphone: MicrophoneSetting): void;
  chooseLanguage(language: Language): void;
  openApp(): void;
  openSettings(): void;
  quit(): void;
};

const EXCERPT_LENGTH = 48;

const LANGUAGES: ReadonlyArray<{ id: Language; label: string }> = [
  { id: 'sk', label: 'Slovenčina' },
  { id: 'cs', label: 'Čeština' },
  { id: 'en', label: 'Angličtina' },
  { id: 'auto', label: 'Automaticky' },
];

const SEPARATOR: MenuItemConstructorOptions = { type: 'separator' };

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= EXCERPT_LENGTH) {
    return flat;
  }
  return `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}

function lastTranscriptItems(model: TrayMenuModel, actions: TrayMenuActions): MenuItemConstructorOptions[] {
  const header: MenuItemConstructorOptions = { label: 'Posledné diktovanie', enabled: false };
  const copy: MenuItemConstructorOptions = { label: 'Kopírovať posledné diktovanie', enabled: model.lastTranscript !== null, click: () => actions.copyLast() };
  const paste: MenuItemConstructorOptions = {
    label: 'Vložiť posledný prepis',
    accelerator: 'Control+Command+V',
    registerAccelerator: false,
    enabled: model.lastTranscript !== null,
    click: () => actions.pasteLast(),
  };
  if (model.lastTranscript === null) {
    return [header, copy, paste];
  }
  return [header, { label: excerpt(model.lastTranscript), enabled: false }, copy, paste];
}

function isSystemDefault(microphone: MicrophoneSetting): boolean {
  return microphone.deviceId === null && microphone.label === null;
}

function missingDeviceItems(model: TrayMenuModel): MenuItemConstructorOptions[] {
  const { microphone, devices } = model;
  if (isSystemDefault(microphone) || devices.some((device) => device.deviceId === microphone.deviceId)) {
    return [];
  }
  return [{ label: `${microphone.label ?? 'Vybraný mikrofón'} (nepripojený)`, type: 'radio', checked: true, enabled: false }];
}

function microphoneMenu(model: TrayMenuModel, actions: TrayMenuActions): MenuItemConstructorOptions {
  const systemDefault: MenuItemConstructorOptions = {
    label: 'Systémový predvolený',
    type: 'radio',
    checked: isSystemDefault(model.microphone),
    click: () => actions.chooseMicrophone({ deviceId: null, label: null }),
  };
  const devices = model.devices.map(
    (device): MenuItemConstructorOptions => ({
      label: device.label,
      type: 'radio',
      checked: device.deviceId === model.microphone.deviceId,
      click: () => actions.chooseMicrophone({ deviceId: device.deviceId, label: device.label }),
    }),
  );
  return { label: 'Mikrofón', submenu: [systemDefault, SEPARATOR, ...devices, ...missingDeviceItems(model)] };
}

function languageMenu(model: TrayMenuModel, actions: TrayMenuActions): MenuItemConstructorOptions {
  return {
    label: 'Jazyk',
    submenu: LANGUAGES.map(
      ({ id, label }): MenuItemConstructorOptions => ({
        label,
        type: 'radio',
        checked: model.language === id,
        enabled: id !== 'auto' || model.autoLanguageAllowed,
        click: () => actions.chooseLanguage(id),
      }),
    ),
  };
}

export function trayMenuTemplate(model: TrayMenuModel, actions: TrayMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: model.status, enabled: false },
    SEPARATOR,
    ...lastTranscriptItems(model, actions),
    SEPARATOR,
    { label: model.paused ? 'Pokračovať' : 'Pozastaviť diktovanie', click: () => actions.togglePause() },
    microphoneMenu(model, actions),
    languageMenu(model, actions),
    SEPARATOR,
    { label: 'Otvoriť Codevo Whisper', click: () => actions.openApp() },
    { label: 'Nastavenia…', accelerator: 'Command+,', registerAccelerator: false, click: () => actions.openSettings() },
    SEPARATOR,
    { label: 'Ukončiť Codevo Whisper', accelerator: 'Command+Q', registerAccelerator: false, click: () => actions.quit() },
  ];
}
