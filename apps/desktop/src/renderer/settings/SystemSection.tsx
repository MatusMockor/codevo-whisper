import { useState } from 'react';
import { Switch } from '../components/Switch';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { saveSettings } from './use-settings';

type ResetState = 'idle' | 'confirm' | 'done' | 'failed';

const RESET_NOTES: Readonly<Record<ResetState, string>> = {
  idle: 'Súčty slov, diktovaní a času za každý deň. Bez textu a bez názvov aplikácií.',
  confirm: 'Naozaj chcete vymazať všetky štatistiky? Táto akcia sa nedá vrátiť.',
  done: 'Štatistiky sú vynulované.',
  failed: 'Štatistiky sa nepodarilo vynulovať.',
};

function ResetStats() {
  const [state, setState] = useState<ResetState>('idle');

  function reset(): void {
    window.codevo.resetStats().then(
      () => setState('done'),
      (error: unknown) => {
        console.error('Resetting the statistics failed', error);
        setState('failed');
      },
    );
  }

  return (
    <SettingsRow title="Štatistiky" description={<span aria-live="polite">{RESET_NOTES[state]}</span>}>
      {state === 'confirm' ? (
        <div className="row-btns">
          <button type="button" className="btn ghost" onClick={() => setState('idle')}>
            Zrušiť
          </button>
          <button type="button" className="btn danger" onClick={reset}>
            Áno, vynulovať
          </button>
        </div>
      ) : (
        <button type="button" className="btn danger" onClick={() => setState('confirm')}>
          Vynulovať štatistiky
        </button>
      )}
    </SettingsRow>
  );
}

export function SystemSection({ launchAtLogin }: { launchAtLogin: boolean }) {
  return (
    <SettingsGroup title="Systém">
      <SettingsRow title="Spustiť po prihlásení" description="Codevo Whisper sa potichu usadí v lište.">
        <Switch label="Spustiť po prihlásení" checked={launchAtLogin} onChange={(checked) => saveSettings({ launchAtLogin: checked })} />
      </SettingsRow>
      <ResetStats />
    </SettingsGroup>
  );
}
