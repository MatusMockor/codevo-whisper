import type { ModelInfo } from '../../shared/models';
import type { DictationMode, Language, OverlayMode, Settings } from '../../shared/settings';
import { HotkeyRecorder } from '../components/HotkeyRecorder';
import { SegmentedControl, type SegmentOption } from '../components/SegmentedControl';
import { languageNote, languageOptions } from './language-options';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { saveSettings } from './use-settings';

const MODES: ReadonlyArray<SegmentOption<DictationMode>> = [
  { id: 'smart', label: 'Inteligentný' },
  { id: 'hold', label: 'Podrž klávesu' },
  { id: 'toggle', label: 'Prepínanie' },
];

const MODE_DESCRIPTIONS: Readonly<Record<DictationMode, string>> = {
  smart: 'Krátke stlačenie zapne diktovanie, ďalšie ho ukončí. Pri podržaní aspoň 300 ms sa diktovanie ukončí uvoľnením klávesu.',
  hold: 'Nahráva sa, kým kláves držíte.',
  toggle: 'Prvé stlačenie začne nahrávať, druhé ukončí.',
};

const OVERLAYS: ReadonlyArray<SegmentOption<OverlayMode>> = [
  { id: 'indicator', label: 'Indikátor' },
  { id: 'live', label: 'Živý text' },
];

function LanguageSelect({ language, activeModel }: { language: Language; activeModel: ModelInfo | null }) {
  return (
    <select
      className="select"
      aria-labelledby="set-language"
      value={language}
      onChange={(event) => {
        const next = languageOptions(activeModel?.languageHint ?? null).find((option) => option.id === event.target.value);
        if (next === undefined || next.disabled) {
          return;
        }
        saveSettings({ language: next.id });
      }}
    >
      {languageOptions(activeModel?.languageHint ?? null).map((option) => (
        <option key={option.id} value={option.id} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function DictationSection({ settings, activeModel }: { settings: Settings; activeModel: ModelInfo | null }) {
  return (
    <SettingsGroup title="Diktovanie">
      <SettingsRow title="Klávesová skratka" titleId="set-hotkey" description="Odporúčame pravý ⌃ Control alebo Fn, nekolidujú s inými skratkami.">
        <HotkeyRecorder hotkey={settings.hotkey} labelledBy="set-hotkey" onRecorded={(hotkey) => saveSettings({ hotkey })} />
      </SettingsRow>
      <SettingsRow title="Režim" description={MODE_DESCRIPTIONS[settings.mode]}>
        <SegmentedControl label="Režim klávesu" options={MODES} value={settings.mode} onChange={(mode) => saveSettings({ mode })} />
      </SettingsRow>
      <SettingsRow title="Zobrazenie panela" description="Živý text ukazuje prepis už počas hovorenia. Indikátor je diskrétnejší a prepis je rýchlejší.">
        <SegmentedControl label="Zobrazenie panela" options={OVERLAYS} value={settings.overlay} onChange={(overlay) => saveSettings({ overlay })} />
      </SettingsRow>
      <SettingsRow title="Jazyk" titleId="set-language" description={languageNote(activeModel)}>
        <LanguageSelect language={settings.language} activeModel={activeModel} />
      </SettingsRow>
    </SettingsGroup>
  );
}
