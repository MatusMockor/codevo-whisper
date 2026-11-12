import type { Settings } from '../../shared/settings';
import { Glyph } from '../components/Glyph';
import { hotkeyVerb } from '../home/banner-content';
import { useLiveValue } from '../home/live-value';
import { tryHint, type EngineChoice } from './engine-choice';
import { TRY_FINISH } from './steps';

const loadStatus = () => window.codevo.getStatus();

function TryHint({ hint }: { hint: string | null }) {
  if (hint === null) {
    return null;
  }
  return (
    <div className="ob-alert" role="status">
      <Glyph name="warn" />
      <p>{hint}</p>
    </div>
  );
}

export function TryStep({ settings, choice }: { settings: Settings; choice: EngineChoice | null }) {
  const status = useLiveValue('status-changed', loadStatus);
  if (settings.hotkey === null) {
    return (
      <p className="field-note warn ob-missing">
        <Glyph name="warn" size="sm" />
        Najprv nastavte klávesovú skratku v kroku 3.
      </p>
    );
  }
  const hint = tryHint(choice, status.kind === 'ready' ? status.value : null);
  return (
    <>
      <div className="ob-try-how">
        <p className="ob-try">
          {hotkeyVerb(settings.mode)} <kbd>{settings.hotkey.label}</kbd> a povedzte niečo.
        </p>
        <p className="ob-finish">{TRY_FINISH[settings.mode]}</p>
      </div>
      <textarea className="ob-pad" aria-label="Skúšobné pole" placeholder="Kliknite sem a nadiktujte prvú vetu…" rows={4} />
      <TryHint hint={hint} />
    </>
  );
}
