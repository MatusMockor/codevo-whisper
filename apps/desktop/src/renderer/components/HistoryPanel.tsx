import { useEffect, useRef, useState } from 'react';
import { HISTORY_MEMORY_NOTE, HISTORY_SAVE_ERROR, HISTORY_UNAVAILABLE, useHistory } from '../history/use-history';

type Action = { kind: 'idle' } | { kind: 'confirm' } | { kind: 'pending' } | { kind: 'done'; message: string } | { kind: 'failed' };
const dateTime = new Intl.DateTimeFormat('sk', { dateStyle: 'medium', timeStyle: 'short' });

export function HistoryPanel() {
  const history = useHistory();
  const [action, setAction] = useState<Action>({ kind: 'idle' });
  const heading = useRef<HTMLHeadingElement>(null);
  const clear = useRef<HTMLButtonElement>(null);
  const pending = action.kind === 'pending';
  const view = history.kind === 'ready' ? history.value : null;

  useEffect(() => {
    if (action.kind === 'done') heading.current?.focus();
  }, [action]);

  function remove(run: () => Promise<void>, message: string): void {
    setAction({ kind: 'pending' });
    run().then(() => setAction({ kind: 'done', message }), () => setAction({ kind: 'failed' }));
  }

  function cancel(): void {
    setAction({ kind: 'idle' });
    clear.current?.focus();
  }

  return (
    <section className="last history" aria-labelledby="h-history" aria-busy={pending} onKeyDown={(event) => { if (action.kind === 'confirm' && event.key === 'Escape') cancel(); }}>
      <div className="last-top">
        <h2 id="h-history" ref={heading} tabIndex={-1}>História prepisov</h2>
        {view?.kind === 'ready' && view.entries.length > 0 && <button ref={clear} type="button" className="btn danger" disabled={pending} onClick={() => setAction({ kind: 'confirm' })}>Vymazať históriu</button>}
      </div>
      {history.kind === 'loading' ? <p className="empty" role="status">Načítava sa história…</p>
        : view?.kind !== 'ready' ? <p className="load-error" role="alert">{HISTORY_UNAVAILABLE}</p>
          : <>
            {view.writeError && <p className="load-error" role="alert">{HISTORY_SAVE_ERROR}</p>}
            {!view.policy.enabled ? <p className="empty">História je vypnutá. Zapnete ju v Nastaveniach. Ukladať sa budú iba budúce dokončené prepisy, nikdy zvuk.</p>
              : view.entries.length === 0 ? <p className="empty">Zatiaľ nemáte žiadne uložené prepisy. Po dokončení ďalšieho diktovania sa tu zobrazí jeho text.</p>
                : <ol className="history-list" aria-label="Uložené prepisy">
                  {view.entries.map((entry, index) => <li key={entry.id}>
                    <div className="history-entry-top">
                      <time dateTime={new Date(entry.completedAt).toISOString()}>{dateTime.format(entry.completedAt)}</time>
                      <button type="button" className="btn ghost" disabled={pending || action.kind === 'confirm'} aria-label={`Vymazať prepis ${index + 1}`} onClick={() => remove(() => window.codevo.deleteHistoryEntry(entry.id), 'Prepis je vymazaný.')}>Vymazať</button>
                    </div>
                    <p className="history-text">{entry.text}</p>
                  </li>)}
                </ol>}
            {action.kind === 'confirm' && <div className="history-confirm">
              <p id="history-clear-confirm">Vymazať všetky uložené prepisy? {HISTORY_MEMORY_NOTE} História ostane zapnutá a môže ukladať ďalšie dokončené diktovania.</p>
              <div className="row-btns">
                <button type="button" className="btn ghost" onClick={cancel}>Zrušiť</button>
                <button type="button" className="btn danger" aria-describedby="history-clear-confirm" onClick={() => remove(() => window.codevo.clearHistory(), 'História je vymazaná.')}>Áno, vymazať históriu</button>
              </div>
            </div>}
          </>}
      {action.kind === 'failed' && <p className="load-error" role="alert">{HISTORY_SAVE_ERROR}</p>}
      <p className="history-feedback" role="status">{pending ? 'Ukladá sa…' : action.kind === 'done' ? action.message : ''}</p>
      <p className="note">{HISTORY_MEMORY_NOTE}</p>
    </section>
  );
}
