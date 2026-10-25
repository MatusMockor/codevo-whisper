import type { Settings } from '../../shared/settings';
import { hotkeyVerb } from '../home/banner-content';

export function TryStep({ settings, modelReady }: { settings: Settings; modelReady: boolean }) {
  if (settings.hotkey === null) {
    return <p className="field-note warn">Najprv nastavte klávesovú skratku v kroku 3.</p>;
  }
  return (
    <>
      <p className="ob-try">
        {hotkeyVerb(settings.mode)} <kbd>{settings.hotkey.label}</kbd> a povedzte niečo.
      </p>
      {!modelReady && <p className="field-note">Model sa ešte sťahuje alebo nie je vybraný. Diktovanie začne fungovať, keď bude pripravený.</p>}
      <textarea className="ob-pad" aria-label="Skúšobné pole" placeholder="Kliknite sem a vyskúšajte diktovanie." rows={4} />
    </>
  );
}
