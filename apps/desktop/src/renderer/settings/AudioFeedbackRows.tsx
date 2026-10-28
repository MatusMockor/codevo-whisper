import { useEffect, useState } from 'react';
import type { OutputAudioView } from '../../shared/recording-audio';
import type { Settings } from '../../shared/settings';
import { Switch } from '../components/Switch';
import { SettingsRow } from './SettingsGroup';
import { saveSettings } from './use-settings';

type OutputState = OutputAudioView | { kind: 'loading' } | { kind: 'failed' };

function useOutputAudio(): OutputState {
  const [state, setState] = useState<OutputState>({ kind: 'loading' });
  useEffect(() => {
    let current = 0;
    let active = true;
    const refresh = (): void => {
      const request = ++current;
      window.codevo.getOutputAudio().then(
        (view) => { if (active && request === current) setState(view); },
        (error: unknown) => {
          console.error('Output audio discovery failed', error);
          if (active && request === current) setState({ kind: 'failed' });
        },
      );
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return state;
}

function outputNote(state: OutputState): string {
  switch (state.kind) {
    case 'loading': return 'Načítavajú sa výstupné zariadenia…';
    case 'failed': return 'Výstupné zariadenia sa nepodarilo načítať. Otvorte Nastavenia znova.';
    case 'unavailable': return state.reason === 'platform' ? 'Zvuková odozva na tomto systéme zatiaľ nie je dostupná.' : 'Nie je dostupné žiadne výstupné zariadenie.';
    case 'available': return 'Krátky zvuk pri začiatku a konci nahrávania.';
  }
}

export function AudioFeedbackRows({ settings }: { settings: Settings }) {
  const state = useOutputAudio();
  const available = state.kind === 'available';
  const disabled = !settings.audioFeedback || !available;
  const outputs = available ? state.outputs : [];
  const missing = settings.feedbackOutputId !== null && !outputs.some((output) => output.id === settings.feedbackOutputId);
  return (
    <>
      <SettingsRow title="Stlmiť počas nahrávania" description={available && state.canMute ? 'Dočasne stlmí systémový výstup a potom obnoví jeho pôvodný stav.' : 'Stlmenie systémového výstupu teraz nie je dostupné.'}>
        <Switch label="Stlmiť počas nahrávania" checked={settings.muteWhileRecording} disabled={!settings.muteWhileRecording && (!available || !state.canMute)} onChange={(muteWhileRecording) => saveSettings({ muteWhileRecording })} />
      </SettingsRow>
      <SettingsRow title="Zvuková odozva" description={<span role={state.kind === 'failed' ? 'alert' : undefined}>{outputNote(state)}</span>}>
        <Switch label="Zvuková odozva" checked={settings.audioFeedback} disabled={!settings.audioFeedback && !available} onChange={(audioFeedback) => saveSettings({ audioFeedback })} />
      </SettingsRow>
      <SettingsRow title="Výstupné zariadenie" titleId="set-feedback-output" description={available && missing ? 'Vybrané zariadenie nie je pripojené. Zvuky použijú systémový predvolený výstup.' : undefined}>
        <select className="select" aria-labelledby="set-feedback-output" disabled={disabled} value={settings.feedbackOutputId ?? ''} onChange={(event) => saveSettings({ feedbackOutputId: event.target.value || null })}>
          <option value="">Systémový predvolený</option>
          {outputs.map((output) => <option key={output.id} value={output.id}>{output.label}</option>)}
          {missing && <option value={settings.feedbackOutputId ?? ''}>Vybrané zariadenie (nepripojené)</option>}
        </select>
      </SettingsRow>
      <SettingsRow title="Hlasitosť" titleId="set-feedback-volume" description="Hlasitosť zvukovej odozvy. Nemení hlasitosť systému.">
        <div className="feedback-volume">
          <input type="range" min="0" max="100" step="1" aria-labelledby="set-feedback-volume" disabled={disabled} value={settings.feedbackVolume} onChange={(event) => saveSettings({ feedbackVolume: event.target.valueAsNumber })} />
          <output aria-live="polite">{settings.feedbackVolume} %</output>
        </div>
      </SettingsRow>
    </>
  );
}
