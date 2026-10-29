import type { EngineId } from '../../shared/settings';
import { SettingsGroup } from './SettingsGroup';
import { saveSettings } from './use-settings';

type EngineOption = { order: EngineId[]; title: string; description: string; usesServer: boolean };

const OPTIONS: readonly EngineOption[] = [
  { order: ['local'], title: 'Lokálne', description: 'Prepisuje sa na tomto Macu stiahnutým modelom. Zvuk neopustí počítač.', usesServer: false },
  { order: ['server'], title: 'Server', description: 'Prepisuje váš spárovaný server. Zvuk putuje zašifrovaný od začiatku do konca.', usesServer: true },
  { order: ['server', 'local'], title: 'Server, potom lokálne', description: 'Keď server pri začatí diktovania nie je dostupný, prepíše sa lokálne.', usesServer: true },
  { order: ['local', 'server'], title: 'Lokálne, potom server', description: 'Keď lokálny model nie je pripravený, zvuk sa pošle zašifrovaný na váš server.', usesServer: true },
];

function sameOrder(left: readonly EngineId[], right: readonly EngineId[]): boolean {
  return left.length === right.length && left.every((engine, index) => engine === right[index]);
}

export function EngineSection({ engineOrder, paired }: { engineOrder: readonly EngineId[]; paired: boolean }) {
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
      <p className="sbox-foot">
        {paired ? 'Výber platí od ďalšieho diktovania, nikdy sa nemení počas neho.' : 'Najprv spárujte server na stránke Server.'}
      </p>
    </SettingsGroup>
  );
}
