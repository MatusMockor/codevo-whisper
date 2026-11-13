import { describe, expect, it } from 'vitest';
import { hotkeyRecordMessage } from '../src/renderer/settings/hotkey-record-message';
import { languageChangeNotice, languageModeOptions, languageRowLabel, needsLanguageChoice, requiredLanguageNote } from '../src/renderer/settings/language-options';
import { levelBars } from '../src/renderer/settings/level-bars';
import { addMicrophone, bluetoothHint, microphoneView, moveMicrophone, removeMicrophone } from '../src/renderer/settings/microphone-options';
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

describe('languageModeOptions', () => {
  it('offers Automaticky unless the active model requires a language', () => {
    expect(languageModeOptions('ignored')).toEqual([
      { id: 'auto', label: 'Automaticky', disabled: false },
      { id: 'selected', label: 'Zvolené jazyky' },
    ]);
    expect(languageModeOptions('required')[0]?.disabled).toBe(true);
    expect(languageModeOptions(null)[0]?.disabled).toBe(false);
  });

  it('explains why Automaticky is off for a model that needs languages', () => {
    expect(requiredLanguageNote(CANARY)).toBe('Model Canary 1B v2 potrebuje zvolené jazyky, automatické rozpoznanie s ním nie je dostupné.');
    expect(requiredLanguageNote({ ...CANARY, languageHint: 'optional' })).toBeNull();
    expect(requiredLanguageNote(null)).toBeNull();
  });

  it('names the used rows with their rank and announces changes', () => {
    expect(languageRowLabel('sk', 0)).toBe('Slovenčina, hlavný jazyk, poradie 1');
    expect(languageRowLabel('cs', 2)).toBe('Čeština, poradie 3');
    expect(languageChangeNotice('de', 'added')).toBe('Nemčina pridaná.');
    expect(languageChangeNotice('uk', 'removed')).toBe('Ukrajinčina odobraná.');
  });
});

describe('needsLanguageChoice', () => {
  it('asks for a language before a model that requires one becomes active while Automaticky is set', () => {
    const auto = { languages: { mode: 'auto', selected: ['sk'] }, localModelId: null } as const;

    expect(needsLanguageChoice(CANARY, 'activate', { ...auto, localModelId: 'parakeet-ultra-q8' })).toBe(true);
    expect(needsLanguageChoice(CANARY, 'download', auto)).toBe(true);
    expect(needsLanguageChoice(CANARY, 'continue', auto)).toBe(true);
    expect(needsLanguageChoice(CANARY, 'download', { ...auto, localModelId: 'parakeet-ultra-q8' })).toBe(false);
    expect(needsLanguageChoice(CANARY, 'activate', { ...auto, languages: { mode: 'selected', selected: ['sk'] } })).toBe(false);
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
    expect(hotkeyRecordMessage('unsupported')).toBe('Túto skratku nemožno použiť. Zvoľte modifikátory alebo modifikátory s jedným klávesom. ⌃⌘V je vyhradená na vloženie posledného prepisu.');
    expect(hotkeyRecordMessage('timeout')).toBe('Nestlačili ste žiadny kláves. Skúste to znova.');
    expect(hotkeyRecordMessage('failed')).toBe('Kláves sa nepodarilo zaznamenať. Skontrolujte povolenie Monitorovanie vstupu.');
  });
});

describe('microphoneView', () => {
  const devices = [
    { deviceId: 'built-in', label: 'Mikrofón MacBooku Pro', isBluetooth: false, isDefault: false },
    { deviceId: 'airpods', label: 'AirPods Pro', isBluetooth: true, isDefault: false },
  ];
  const builtIn = { deviceId: 'built-in', label: 'Mikrofón MacBooku Pro' };
  const airPods = { deviceId: 'airpods', label: 'AirPods Pro' };
  const mv7 = { deviceId: 'mv7', label: 'Shure MV7+' };

  it('uses the system default for an empty list and offers every connected input', () => {
    expect(microphoneView(devices, [])).toEqual({ rows: [], addable: [builtIn, airPods], usingDefault: true });
  });

  it('marks the first connected entry as used and keeps unplugged entries in order', () => {
    expect(microphoneView(devices, [mv7, airPods, builtIn])).toEqual({
      rows: [
        { label: 'Shure MV7+', state: 'missing', microphone: mv7 },
        { label: 'AirPods Pro', state: 'active', microphone: airPods },
        { label: 'Mikrofón MacBooku Pro', state: 'connected', microphone: builtIn },
      ],
      addable: [],
      usingDefault: false,
    });
  });

  it('falls back to the system default when no entry is connected', () => {
    expect(microphoneView(devices, [mv7])).toMatchObject({ rows: [{ state: 'missing' }], addable: [builtIn, airPods], usingDefault: true });
  });

  it('matches an entry that reconnected under a new id by its label', () => {
    expect(microphoneView(devices, [{ deviceId: 'airpods-old', label: 'AirPods Pro' }])).toMatchObject({ rows: [{ label: 'AirPods Pro', state: 'active' }], addable: [builtIn] });
  });

  it('moves, removes and appends entries without going past either end', () => {
    expect(moveMicrophone([mv7, airPods, builtIn], 2, -1)).toEqual([mv7, builtIn, airPods]);
    expect(moveMicrophone([mv7, airPods, builtIn], 0, 1)).toEqual([airPods, mv7, builtIn]);
    expect(moveMicrophone([mv7, airPods], 0, -1)).toEqual([mv7, airPods]);
    expect(moveMicrophone([mv7, airPods], 1, 1)).toEqual([mv7, airPods]);
    expect(removeMicrophone([mv7, airPods, builtIn], 1)).toEqual([mv7, builtIn]);
    expect(addMicrophone([mv7], airPods)).toEqual([mv7, airPods]);
  });

  it('shows the Bluetooth hint only when recording uses a Bluetooth input', () => {
    expect(bluetoothHint(devices, [mv7, airPods])).toBe(
      'Bluetooth slúchadlá sa pri zapnutom mikrofóne prepnú na hovorový profil, takže sa zhorší aj zvuk hudby. Ak počúvate cez AirPods, odporúčame vstavaný mikrofón Macu.',
    );
    expect(bluetoothHint(devices, [builtIn, airPods])).toBeNull();
    expect(bluetoothHint(devices, [])).toBeNull();
    const airPodsDefault = devices.map((device) => ({ ...device, isDefault: device.isBluetooth }));
    expect(bluetoothHint(airPodsDefault, [])).toContain('Bluetooth slúchadlá');
    expect(bluetoothHint(airPodsDefault, [mv7])).toContain('Bluetooth slúchadlá');
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

 it('treats recorder cancellation as neutral', () => {
  expect(hotkeyRecordMessage('cancelled')).toBeNull();
});
