import { describe, expect, it } from 'vitest';
import { hotkeyRecordMessage } from '../src/renderer/settings/hotkey-record-message';
import { languageNote, languageOptions, needsLanguageChoice } from '../src/renderer/settings/language-options';
import { levelBars } from '../src/renderer/settings/level-bars';
import { bluetoothHint, microphoneOptions, SYSTEM_DEFAULT_VALUE } from '../src/renderer/settings/microphone-options';
import { formatSize, modelRow } from '../src/renderer/settings/model-rows';
import type { ModelInfo, ModelState } from '../src/shared/models';

const CANARY: ModelInfo = {
  id: 'canary-1b-v2-q8',
  name: 'Canary 1B v2',
  quantization: 'Q8_0',
  sizeBytes: 1144290016,
  license: 'CC-BY-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  languageHint: 'required',
  roleLabels: ['Najpresnejší pre slovenčinu a češtinu'],
};

function state(status: ModelState['status'], receivedBytes = 0): ModelState {
  return { id: CANARY.id, status, receivedBytes, totalBytes: CANARY.sizeBytes };
}

describe('languageOptions', () => {
  it('offers Automaticky unless the active model requires a language', () => {
    expect(languageOptions('ignored').map((option) => [option.id, option.label, option.disabled])).toEqual([
      ['sk', 'Slovenčina', false],
      ['cs', 'Čeština', false],
      ['en', 'Angličtina', false],
      ['auto', 'Automaticky', false],
    ]);
    expect(languageOptions('required').find((option) => option.id === 'auto')?.disabled).toBe(true);
    expect(languageOptions(null).find((option) => option.id === 'auto')?.disabled).toBe(false);
  });

  it('explains why Automaticky is off for a model that needs the language', () => {
    expect(languageNote(CANARY)).toBe('Model Canary 1B v2 potrebuje vedieť jazyk, automatické rozpoznanie s ním nie je dostupné.');
    expect(languageNote({ ...CANARY, languageHint: 'optional' })).toBe('Automatické rozpoznanie pridá k prvému slovu asi 0,1 s.');
    expect(languageNote(null)).toBe('Automatické rozpoznanie pridá k prvému slovu asi 0,1 s.');
  });
});

describe('needsLanguageChoice', () => {
  it('asks for a language before a model that requires one becomes active while Automaticky is set', () => {
    const auto = { language: 'auto', localModelId: null } as const;

    expect(needsLanguageChoice(CANARY, 'activate', { ...auto, localModelId: 'parakeet-ultra-q8' })).toBe(true);
    expect(needsLanguageChoice(CANARY, 'download', auto)).toBe(true);
    expect(needsLanguageChoice(CANARY, 'continue', auto)).toBe(true);
    expect(needsLanguageChoice(CANARY, 'download', { ...auto, localModelId: 'parakeet-ultra-q8' })).toBe(false);
    expect(needsLanguageChoice(CANARY, 'activate', { ...auto, language: 'sk' })).toBe(false);
    expect(needsLanguageChoice({ ...CANARY, languageHint: 'ignored' }, 'activate', auto)).toBe(false);
    expect(needsLanguageChoice(CANARY, 'delete', auto)).toBe(false);
  });
});

describe('modelRow', () => {
  it('offers the actions that fit each state', () => {
    expect(modelRow(CANARY, state('not-downloaded'), { activeId: null, busyId: null }).actions).toEqual([{ action: 'download', label: 'Stiahnuť', disabled: false }]);
    expect(modelRow(CANARY, state('downloading', 572145008), { activeId: null, busyId: CANARY.id })).toMatchObject({
      status: 'Sťahuje sa, 50 %',
      progress: 0.5,
      actions: [
        { action: 'pause', label: 'Pozastaviť', disabled: false },
        { action: 'delete', label: 'Odstrániť', disabled: false },
      ],
    });
    expect(modelRow(CANARY, state('paused', 114429002), { activeId: null, busyId: null })).toMatchObject({
      status: 'Pozastavené, 10 %',
      actions: [
        { action: 'continue', label: 'Pokračovať', disabled: false },
        { action: 'delete', label: 'Odstrániť', disabled: false },
      ],
    });
    expect(modelRow(CANARY, state('ready', CANARY.sizeBytes), { activeId: null, busyId: null })).toMatchObject({
      status: 'Stiahnutý',
      active: false,
      actions: [
        { action: 'activate', label: 'Použiť', disabled: false },
        { action: 'delete', label: 'Odstrániť', disabled: false },
      ],
    });
    expect(modelRow(CANARY, state('ready', CANARY.sizeBytes), { activeId: CANARY.id, busyId: null })).toMatchObject({
      status: 'Používa sa',
      active: true,
      actions: [{ action: 'delete', label: 'Odstrániť', disabled: false }],
    });
    expect(modelRow(CANARY, state('broken'), { activeId: null, busyId: null })).toMatchObject({
      status: 'Súbor je poškodený',
      actions: [
        { action: 'download', label: 'Stiahnuť znova', disabled: false },
        { action: 'delete', label: 'Odstrániť', disabled: false },
      ],
    });
  });

  it('blocks a second download while another model downloads', () => {
    expect(modelRow(CANARY, state('not-downloaded'), { activeId: null, busyId: 'parakeet-ultra-q8' }).actions).toEqual([{ action: 'download', label: 'Stiahnuť', disabled: true }]);
    expect(modelRow(CANARY, state('paused', 10), { activeId: null, busyId: 'parakeet-ultra-q8' }).actions[0]).toEqual({ action: 'continue', label: 'Pokračovať', disabled: true });
  });

  it('describes size, roles and license', () => {
    expect(modelRow(CANARY, state('not-downloaded'), { activeId: null, busyId: null })).toMatchObject({ size: '1,1 GB', roles: ['Najpresnejší pre slovenčinu a češtinu'], license: 'CC-BY-4.0' });
    expect([formatSize(740363168), formatSize(486280096), formatSize(886381728)]).toEqual(['740 MB', '486 MB', '886 MB']);
  });
});

describe('hotkeyRecordMessage', () => {
  it('explains unsupported keys, timeouts and failures', () => {
    expect(hotkeyRecordMessage('unsupported')).toBe('Tento kláves sa nedá použiť. Zvoľte Fn / 🌐, pravý ⌃ Control, ľavý alebo pravý ⌥ Option, alebo pravý ⌘ Command.');
    expect(hotkeyRecordMessage('timeout')).toBe('Nestlačili ste žiadny kláves. Skúste to znova.');
    expect(hotkeyRecordMessage('failed')).toBe('Kláves sa nepodarilo zaznamenať. Skontrolujte povolenie Monitorovanie vstupu.');
  });
});

describe('microphoneOptions', () => {
  const devices = [
    { deviceId: 'built-in', label: 'Mikrofón MacBooku Pro', isBluetooth: false, isDefault: false },
    { deviceId: 'airpods', label: 'AirPods Pro', isBluetooth: true, isDefault: false },
  ];

  it('starts with the system default and lists the connected inputs', () => {
    expect(microphoneOptions(devices, { deviceId: null, label: null })).toEqual({
      selected: SYSTEM_DEFAULT_VALUE,
      options: [
        { value: SYSTEM_DEFAULT_VALUE, label: 'Systémový predvolený', microphone: { deviceId: null, label: null } },
        { value: 'built-in', label: 'Mikrofón MacBooku Pro', microphone: { deviceId: 'built-in', label: 'Mikrofón MacBooku Pro' } },
        { value: 'airpods', label: 'AirPods Pro', microphone: { deviceId: 'airpods', label: 'AirPods Pro' } },
      ],
    });
  });

  it('keeps a chosen microphone that is not connected right now', () => {
    const view = microphoneOptions(devices, { deviceId: 'mv7', label: 'Shure MV7+' });

    expect(view.selected).toBe('mv7');
    expect(view.options.at(-1)).toEqual({ value: 'mv7', label: 'Shure MV7+ (nepripojený)', microphone: { deviceId: 'mv7', label: 'Shure MV7+' } });
  });

  it('shows the Bluetooth hint only for a Bluetooth input', () => {
    expect(bluetoothHint(devices, { deviceId: 'airpods', label: 'AirPods Pro' })).toBe(
      'Bluetooth slúchadlá sa pri zapnutom mikrofóne prepnú na hovorový profil, takže sa zhorší aj zvuk hudby. Ak počúvate cez AirPods, odporúčame vstavaný mikrofón Macu.',
    );
    expect(bluetoothHint(devices, { deviceId: 'built-in', label: 'Mikrofón MacBooku Pro' })).toBeNull();
    expect(bluetoothHint(devices, { deviceId: null, label: null })).toBeNull();
    const airPodsDefault = devices.map((device) => ({ ...device, isDefault: device.isBluetooth }));
    expect(bluetoothHint(airPodsDefault, { deviceId: null, label: null })).toContain('Bluetooth slúchadlá');
  });
});

describe('levelBars', () => {
  it('maps the RMS level to lit bars on a decibel scale', () => {
    expect(levelBars(0, 24)).toBe(0);
    expect(levelBars(0.001, 24)).toBe(0);
    expect(levelBars(0.1, 24)).toBe(16);
    expect(levelBars(1, 24)).toBe(24);
    expect(levelBars(4, 24)).toBe(24);
  });
});
