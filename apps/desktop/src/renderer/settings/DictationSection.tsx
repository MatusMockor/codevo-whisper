import type { ModelInfo } from '../../shared/models';
import { REBINDABLE_ACTIONS, sessionShortcutLabel, type RebindableAction } from '../../shared/session-shortcuts';
import type { DictationMode, OverlayMode, Settings } from '../../shared/settings';
import { HotkeyRecorder } from '../components/HotkeyRecorder';
import { SegmentedControl, type SegmentOption } from '../components/SegmentedControl';
import { DictationLanguagesRow } from './DictationLanguagesRow';
import { MODE_DESCRIPTIONS } from './mode-descriptions';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { saveSettings } from './use-settings';
import { AudioFeedbackRows } from './AudioFeedbackRows';

const MODES: ReadonlyArray<SegmentOption<DictationMode>> = [
  { id: 'smart', label: 'Inteligentný' },
  { id: 'hold', label: 'Podrž klávesu' },
  { id: 'toggle', label: 'Prepínanie' },
];

const OVERLAYS: ReadonlyArray<SegmentOption<OverlayMode>> = [
  { id: 'indicator', label: 'Indikátor' },
  { id: 'live', label: 'Živý text' },
];

const MAC = !navigator.userAgent.includes('Linux');

const SESSION_SHORTCUT_ROWS: Readonly<Record<RebindableAction, { id: 'polish-shortcut' | 'language-shortcut'; title: string; description: string }>> = {
  'toggle-polish': { id: 'polish-shortcut', title: 'Skratka AI úpravy', description: 'Počas diktovania zapne alebo vypne AI úpravu len pre tento prepis.' },
  'cycle-language': { id: 'language-shortcut', title: 'Skratka jazyka', description: 'Počas nahrávania prepína AUTO a zvolené jazyky len pre tento prepis.' },
};

const SESSION_SHORTCUT_NOTE = navigator.userAgent.includes('Linux')
  ? 'Modifikátor s písmenom, číslicou alebo F1–F12. Platí iba počas diktovania. Na Waylande ju dostane aj aktívna aplikácia.'
  : 'Modifikátor s písmenom, číslicou alebo F1–F12. Platí iba počas diktovania.';

function SessionShortcutRow({ action, settings }: { action: RebindableAction; settings: Settings }) {
  const row = SESSION_SHORTCUT_ROWS[action];
  return (
    <SettingsRow id={row.id} title={row.title} titleId={`set-${row.id}`} description={row.description}>
      <HotkeyRecorder
        label={sessionShortcutLabel(settings.sessionShortcuts[action], MAC)}
        labelledBy={`set-${row.id}`}
        note={SESSION_SHORTCUT_NOTE}
        record={() => window.codevo.recordSessionShortcut(action)}
        onRecorded={(binding) => saveSettings({ sessionShortcuts: { ...settings.sessionShortcuts, [action]: binding } })}
      />
    </SettingsRow>
  );
}

export function DictationSection({ settings, activeModel }: { settings: Settings; activeModel: ModelInfo | null }) {
  return (
    <SettingsGroup group="dictation">
      <SettingsRow id="hotkey" title="Klávesová skratka" titleId="set-hotkey" description={navigator.userAgent.includes('Linux') ? 'Nahrajte skratku pre aktuálnu reláciu X11 alebo Wayland. Ctrl+Super+V je vyhradené na posledný prepis.' : 'Zvoľte napríklad ⌃Space, ⌥⇧D alebo kombináciu modifikátorov.'}>
        <HotkeyRecorder label={settings.hotkey?.label ?? null} labelledBy="set-hotkey" record={() => window.codevo.recordHotkey()} onRecorded={(hotkey) => saveSettings({ hotkey })} />
      </SettingsRow>
      {REBINDABLE_ACTIONS.map((action) => (
        <SessionShortcutRow key={action} action={action} settings={settings} />
      ))}
      <SettingsRow id="mode" title="Režim" description={MODE_DESCRIPTIONS[settings.mode]}>
        <SegmentedControl label="Režim klávesu" options={MODES} value={settings.mode} onChange={(mode) => saveSettings({ mode })} />
      </SettingsRow>
      <SettingsRow id="overlay" title="Zobrazenie panela" description="Živý text ukazuje prepis už počas hovorenia. Indikátor je diskrétnejší a prepis je rýchlejší.">
        <SegmentedControl label="Zobrazenie panela" options={OVERLAYS} value={settings.overlay} onChange={(overlay) => saveSettings({ overlay })} />
      </SettingsRow>
      <DictationLanguagesRow languages={settings.languages} activeModel={activeModel} engineOrder={settings.engineOrder} />
      <AudioFeedbackRows settings={settings} />
    </SettingsGroup>
  );
}
