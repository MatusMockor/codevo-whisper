import type { Settings } from '../../shared/settings';
import { hotkeyVerb } from '../home/banner-content';
import { useLiveValue } from '../home/live-value';
import { tryHint, type EngineChoice } from './engine-choice';

const loadStatus = () => window.codevo.getStatus();

export function TryStep({ settings, choice }: { settings: Settings; choice: EngineChoice | null }) {
  const status = useLiveValue('status-changed', loadStatus);
  if (settings.hotkey === null) {
    return <p className="field-note warn">Najprv nastavte klávesovú skratku v kroku 3.</p>;
  }
  const hint = tryHint(choice, status.kind === 'ready' ? status.value : null);
  return (
    <>
      <p className="ob-try">
        {hotkeyVerb(settings.mode)} <kbd>{settings.hotkey.label}</kbd> a povedzte niečo.
      </p>
      {hint !== null && <p className="field-note">{hint}</p>}
      <textarea className="ob-pad" aria-label="Skúšobné pole" placeholder="Kliknite sem a vyskúšajte diktovanie." rows={4} />
    </>
  );
}
