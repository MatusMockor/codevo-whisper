import type { MenuItemConstructorOptions } from 'electron';
import { resolveDevice, type AudioDevice } from '../../shared/microphones';
import type { LanguageMode, LanguageSelection } from '../../shared/dictation-languages';
import type { MicrophoneSetting } from '../../shared/settings';

export type TrayMenuModel = {
  status: string;
  lastTranscript: string | null;
  paused: boolean;
  devices: readonly AudioDevice[];
  microphones: readonly MicrophoneSetting[];
  languages: LanguageSelection;
  autoLanguageAllowed: boolean;
  readyUpdate: string | null;
  installingUpdate: boolean;
  updateCheckable: boolean;
  retryable: boolean;
};

export type TrayMenuActions = {
  copyLast(): void;
  pasteLast(): void;
  togglePause(): void;
  chooseMicrophone(microphone: MicrophoneSetting | null): void;
  chooseLanguageMode(mode: LanguageMode): void;
  editLanguages(): void;
  openApp(): void;
  openSettings(): void;
  quit(): void;
  installUpdate(): void;
  checkForUpdates(): void;
  retry(): void;
};

const EXCERPT_LENGTH = 48;

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

function missingDeviceItems({ microphones, devices }: TrayMenuModel): MenuItemConstructorOptions[] {
  const first = microphones[0];
  if (first === undefined || resolveDevice(devices, [first]).device !== null) {
    return [];
  }
  return [{ label: `${first.label ?? 'Vybraný mikrofón'} (nepripojený)`, type: 'radio', checked: false, enabled: false }];
}

function microphoneMenu(model: TrayMenuModel, actions: TrayMenuActions): MenuItemConstructorOptions {
  const recording = resolveDevice(model.devices, model.microphones).device;
  const systemDefault: MenuItemConstructorOptions = {
    label: 'Systémový predvolený',
    type: 'radio',
    checked: recording === null,
    click: () => actions.chooseMicrophone(null),
  };
  const devices = model.devices.map(
    (device): MenuItemConstructorOptions => ({
      label: device.label,
      type: 'radio',
      checked: device.deviceId === recording?.deviceId,
      click: () => actions.chooseMicrophone({ deviceId: device.deviceId, label: device.label }),
    }),
  );
  return { label: 'Mikrofón', submenu: [systemDefault, SEPARATOR, ...devices, ...missingDeviceItems(model)] };
}

function selectedLabel(languages: LanguageSelection): string {
  return `Zvolené: ${languages.selected.map((language) => language.toUpperCase()).join(', ')}`;
}

function languageMenu(model: TrayMenuModel, actions: TrayMenuActions): MenuItemConstructorOptions {
  const { languages } = model;
  return {
    label: 'Jazyk',
    submenu: [
      { label: 'Automaticky', type: 'radio', checked: languages.mode === 'auto', enabled: model.autoLanguageAllowed, click: () => actions.chooseLanguageMode('auto') },
      { label: selectedLabel(languages), type: 'radio', checked: languages.mode === 'selected', click: () => actions.chooseLanguageMode('selected') },
      SEPARATOR,
      { label: 'Upraviť jazyky…', click: () => actions.editLanguages() },
    ],
  };
}

function updateItems(model: TrayMenuModel, actions: TrayMenuActions): MenuItemConstructorOptions[] {
  if (model.readyUpdate === null) {
    return [];
  }
  return [{ label: `Reštartovať a aktualizovať na verziu ${model.readyUpdate}`, click: () => actions.installUpdate() }];
}

export function trayMenuTemplate(model: TrayMenuModel, actions: TrayMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: model.status, enabled: false },
    ...updateItems(model, actions),
    { label: 'Skúsiť znova', enabled: model.retryable, click: () => actions.retry() },
    SEPARATOR,
    ...lastTranscriptItems(model, actions),
    SEPARATOR,
    { label: model.paused ? 'Pokračovať' : 'Pozastaviť diktovanie', enabled: !model.installingUpdate, click: () => actions.togglePause() },
    microphoneMenu(model, actions),
    languageMenu(model, actions),
    SEPARATOR,
    { label: 'Otvoriť Codevo Whisper', click: () => actions.openApp() },
    { label: 'Nastavenia…', accelerator: 'Command+,', registerAccelerator: false, click: () => actions.openSettings() },
    { label: 'Skontrolovať aktualizácie', enabled: model.updateCheckable, click: () => actions.checkForUpdates() },
    SEPARATOR,
    { label: 'Ukončiť Codevo Whisper', accelerator: 'Command+Q', registerAccelerator: false, click: () => actions.quit() },
  ];
}
