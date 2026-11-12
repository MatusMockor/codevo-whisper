import type { ModelInfo } from '../../shared/models';
import type { DictationMode, OverlayMode, Settings } from '../../shared/settings';
import { HotkeyRecorder } from '../components/HotkeyRecorder';
import { SegmentedControl, type SegmentOption } from '../components/SegmentedControl';
import { DictationLanguagesRow } from './DictationLanguagesRow';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { saveSettings } from './use-settings';
import { AudioFeedbackRows } from './AudioFeedbackRows';

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

export function DictationSection({ settings, activeModel }: { settings: Settings; activeModel: ModelInfo | null }) {
  return (
    <SettingsGroup group="dictation">
      <SettingsRow id="hotkey" title="Klávesová skratka" titleId="set-hotkey" description={navigator.userAgent.includes('Linux') ? 'Nahrajte skratku pre aktuálnu reláciu X11 alebo Wayland. Ctrl+Super+V je vyhradené na posledný prepis.' : 'Zvoľte napríklad ⌃Space, ⌥⇧D alebo kombináciu modifikátorov.'}>
        <HotkeyRecorder hotkey={settings.hotkey} labelledBy="set-hotkey" onRecorded={(hotkey) => saveSettings({ hotkey })} />
      </SettingsRow>
      <SettingsRow id="mode" title="Režim" description={MODE_DESCRIPTIONS[settings.mode]}>
        <SegmentedControl label="Režim klávesu" options={MODES} value={settings.mode} onChange={(mode) => saveSettings({ mode })} />
      </SettingsRow>
      <SettingsRow id="overlay" title="Zobrazenie panela" description="Živý text ukazuje prepis už počas hovorenia. Indikátor je diskrétnejší a prepis je rýchlejší.">
        <SegmentedControl label="Zobrazenie panela" options={OVERLAYS} value={settings.overlay} onChange={(overlay) => saveSettings({ overlay })} />
      </SettingsRow>
      <DictationLanguagesRow languages={settings.languages} activeModel={activeModel} />
      <AudioFeedbackRows settings={settings} />
    </SettingsGroup>
  );
}
