import { useEffect, useRef, useState } from 'react';
import { HISTORY_LIMITS, type HistoryPolicy } from '../../shared/history';
import { Switch } from '../components/Switch';
import { HISTORY_MEMORY_NOTE, HISTORY_SAVE_ERROR, HISTORY_UNAVAILABLE, useHistory } from '../history/use-history';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

type Action = 'idle' | 'confirm' | 'pending' | 'done' | 'failed';

export function HistorySection() {
  const history = useHistory();
  const [action, setAction] = useState<Action>('idle');
  const toggle = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const pending = action === 'pending';

  useEffect(() => {
    if (action !== 'done' && action !== 'failed') return;
    if (origin.current?.isConnected) {
      origin.current.focus();
      return;
    }
    toggle.current?.querySelector('button')?.focus();
  }, [action]);

  function cancel(): void {
    setAction('idle');
    toggle.current?.querySelector('button')?.focus();
  }

  function configure(policy: HistoryPolicy): void {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAction('pending');
    window.codevo.configureHistory(policy).then(
      () => setAction('done'),
      () => setAction('failed'),
    );
  }

  const view = history.kind === 'ready' ? history.value : null;
  return (
    <SettingsGroup title="História prepisov">
      {history.kind === 'loading' ? <p className="sbox-lead" role="status">Načítava sa história…</p>
        : view?.kind !== 'ready' ? <p className="sbox-lead load-error" role="alert">{HISTORY_UNAVAILABLE}</p>
          : <>
            <SettingsRow title="Ukladať históriu prepisov" description="Predvolene vypnuté. Po zapnutí sa ukladajú iba budúce dokončené prepisy ako lokálny text, nikdy zvuk. Vypnutie vymaže uloženú históriu.">
              <div ref={toggle}>
                <Switch label="Ukladať históriu prepisov" checked={view.policy.enabled} disabled={pending} onChange={(enabled) => {
                  if (!enabled && view.entries.length > 0) {
                    setAction('confirm');
                    return;
                  }
                  configure({ ...view.policy, enabled });
                }} />
              </div>
            </SettingsRow>
            <SettingsRow title="Počet uchovaných prepisov" titleId="history-limit" description="Najstaršie prepisy sa automaticky vymažú. Zníženie limitu ich vymaže ihneď; zvýšenie ich neobnoví.">
              <select className="select" aria-labelledby="history-limit" value={view.policy.limit} disabled={pending || action === 'confirm'} onChange={(event) => {
                const limit = HISTORY_LIMITS.find((value) => String(value) === event.target.value);
                if (limit !== undefined) configure({ ...view.policy, limit });
              }}>
                {HISTORY_LIMITS.map((limit) => <option key={limit} value={limit}>{limit}</option>)}
              </select>
            </SettingsRow>
            {action === 'confirm' && <div className="history-confirm" onKeyDown={(event) => { if (event.key === 'Escape') cancel(); }}>
              <p id="history-disable-confirm">Vypnúť históriu a vymazať všetky uložené prepisy? {HISTORY_MEMORY_NOTE}</p>
              <div className="row-btns">
                <button type="button" className="btn ghost" onClick={cancel}>Zrušiť</button>
                <button type="button" className="btn danger" aria-describedby="history-disable-confirm" onClick={() => configure({ ...view.policy, enabled: false })}>Áno, vypnúť a vymazať</button>
              </div>
            </div>}
            {(view.writeError || action === 'failed') && <p className="sbox-foot load-error" role="alert">{HISTORY_SAVE_ERROR}</p>}
            <p className="sbox-foot" role="status">{pending ? 'Ukladá sa…' : action === 'done' ? 'Nastavenie histórie je uložené.' : ''}</p>
          </>}
    </SettingsGroup>
  );
}
