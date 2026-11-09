import { orderFix, type EngineCapabilities, type EngineFix } from '../../shared/engine-routing';
import type { EngineId } from '../../shared/settings';
import { ENGINE_FIX_COPY } from './engine-capabilities';
import { preferEngine } from './prefer-engine';
import { SettingsGroup } from './SettingsGroup';
import { revealSettingsSection } from './use-settings-focus';
import { saveSettings } from './use-settings';

type EngineOption = { order: EngineId[]; title: string; description: string; usesServer: boolean };

type EngineSectionProps = { engineOrder: readonly EngineId[]; paired: boolean; capabilities: EngineCapabilities | null };

const OPTIONS: readonly EngineOption[] = [
  { order: ['local'], title: 'Lokálne', description: 'Prepisuje sa na tomto Macu stiahnutým modelom. Zvuk neopustí počítač.', usesServer: false },
  { order: ['server'], title: 'Server', description: 'Prepisuje váš spárovaný server. Zvuk putuje zašifrovaný od začiatku do konca.', usesServer: true },
  { order: ['server', 'local'], title: 'Server, potom lokálne', description: 'Keď server pri začatí diktovania nie je dostupný, prepíše sa lokálne.', usesServer: true },
  { order: ['local', 'server'], title: 'Lokálne, potom server', description: 'Keď lokálny model nie je pripravený, zvuk sa pošle zašifrovaný na váš server.', usesServer: true },
];

const FIX_ENGINES: Readonly<Record<Exclude<EngineFix, 'download-model'>, EngineId>> = Object.freeze({ 'use-server': 'server', 'use-local': 'local' });

function sameOrder(left: readonly EngineId[], right: readonly EngineId[]): boolean {
  return left.length === right.length && left.every((engine, index) => engine === right[index]);
}

function applyFix(fix: EngineFix): void {
  if (fix === 'download-model') {
    revealSettingsSection('local-model');
    return;
  }
  preferEngine(FIX_ENGINES[fix]);
}

function EngineFixNotice({ fix }: { fix: EngineFix | null }) {
  if (fix === null) {
    return null;
  }
  const copy = ENGINE_FIX_COPY[fix];
  return (
    <div className="use-server engine-fix" role="status">
      <p className="field-note warn">{copy.message}</p>
      <button type="button" className="btn primary" onClick={() => applyFix(fix)}>
        {copy.button}
      </button>
    </div>
  );
}

export function EngineSection({ engineOrder, paired, capabilities }: EngineSectionProps) {
  return (
    <SettingsGroup title="Kde beží prepis">
      <div className="radio" role="radiogroup" aria-label="Kde beží prepis">
        {OPTIONS.map((option) => (
          <label key={option.order.join('-')}>
            <input
              type="radio"
              name="engine-order"
              checked={sameOrder(engineOrder, option.order)}
              disabled={option.usesServer && !paired}
              onChange={() => {
                saveSettings({ engineOrder: option.order });
              }}
            />
            <div>
              <b>{option.title}</b>
              <span>{navigator.userAgent.includes('Linux') ? option.description.replace('na tomto Macu', 'na tomto počítači') : option.description}</span>
            </div>
          </label>
        ))}
      </div>
      <EngineFixNotice fix={capabilities === null ? null : orderFix(engineOrder, capabilities)} />
      <p className="sbox-foot">
        {paired ? 'Výber platí od ďalšieho diktovania, nikdy sa nemení počas neho.' : 'Najprv spárujte server na stránke Server.'}
      </p>
    </SettingsGroup>
  );
}
