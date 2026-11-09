import type { EngineConditions } from '../../shared/engine-routing';
import type { EngineId } from '../../shared/settings';
import { remedyActions, runCommand } from '../home/readiness-actions';
import type { NavTarget } from '../navigation';
import { engineNotice, type EngineNotice } from './engine-notice';
import { EngineSwitchError } from './EngineSwitchError';
import { SettingsGroup } from './SettingsGroup';
import { useEngineSwitch } from './use-engine-switch';
import { saveSettings } from './use-settings';

type EngineOption = { order: EngineId[]; title: string; description: string; usesServer: boolean };

type Navigate = (target: NavTarget) => void;

type EngineSectionProps = { engineOrder: readonly EngineId[]; paired: boolean; conditions: EngineConditions | null; serverHost: string | null; onNavigate: Navigate };

const OPTIONS: readonly EngineOption[] = [
  { order: ['local'], title: 'Lokálne', description: 'Prepisuje sa na tomto Macu stiahnutým modelom. Zvuk neopustí počítač.', usesServer: false },
  { order: ['server'], title: 'Server', description: 'Prepisuje váš spárovaný server. Zvuk putuje zašifrovaný od začiatku do konca.', usesServer: true },
  { order: ['server', 'local'], title: 'Server, potom lokálne', description: 'Keď server pri začatí diktovania nie je dostupný, prepíše sa lokálne.', usesServer: true },
  { order: ['local', 'server'], title: 'Lokálne, potom server', description: 'Keď lokálny model nie je pripravený, zvuk sa pošle zašifrovaný na váš server.', usesServer: true },
];

function sameOrder(left: readonly EngineId[], right: readonly EngineId[]): boolean {
  return left.length === right.length && left.every((engine, index) => engine === right[index]);
}

type EngineNoticeProps = { notice: EngineNotice | null; serverHost: string | null; onNavigate: Navigate; onPrefer: (engine: EngineId) => void };

function EngineFixNotice({ notice, serverHost, onNavigate, onPrefer }: EngineNoticeProps) {
  if (notice === null) {
    return null;
  }
  return (
    <div className="use-server engine-fix" role="status">
      <p className="field-note warn">{notice.message}</p>
      <div className="row-btns">
        {remedyActions(notice.remedy, serverHost).map((action) => (
          <button key={action.id} type="button" className={action.primary ? 'btn primary' : 'btn'} onClick={() => runCommand(action.command, { navigate: onNavigate, prefer: onPrefer })}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EngineSection({ engineOrder, paired, conditions, serverHost, onNavigate }: EngineSectionProps) {
  const engineSwitch = useEngineSwitch();
  return (
    <SettingsGroup title="Kde beží prepis" section="engine">
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
      <EngineFixNotice notice={engineNotice(engineOrder, conditions)} serverHost={serverHost} onNavigate={onNavigate} onPrefer={engineSwitch.prefer} />
      <EngineSwitchError message={engineSwitch.failure} />
      <p className="sbox-foot">
        {paired ? 'Výber platí od ďalšieho diktovania, nikdy sa nemení počas neho.' : 'Najprv spárujte server na stránke Server.'}
      </p>
    </SettingsGroup>
  );
}
