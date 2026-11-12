import type { Settings } from '../../shared/settings';
import { HotkeyRecorder } from '../components/HotkeyRecorder';
import { MODE_DESCRIPTIONS } from '../settings/mode-descriptions';
import { saveSettings } from '../settings/use-settings';

export function HotkeyStep({ settings }: { settings: Settings }) {
  return (
    <div className="card ob-hotkey">
      <div className="ob-hotkey-copy">
        <b id="ob-hotkey-title">Skratka na diktovanie</b>
        <p className="ob-mode">{MODE_DESCRIPTIONS[settings.mode]} Režim zmeníte v Nastaveniach.</p>
      </div>
      <HotkeyRecorder hotkey={settings.hotkey} labelledBy="ob-hotkey-title" onRecorded={(hotkey) => saveSettings({ hotkey })} />
    </div>
  );
}
