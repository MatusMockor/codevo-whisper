import { useId, useState } from 'react';
import type { PairedServerView } from '../../shared/server';
import type { ServerModelOutcome } from '../../shared/server-model-catalog';
import { CommandBox } from './CommandBox';
import { modelOutcomeMessage, OPERATION_FAILED, serverModelsView, type CatalogNotice, type ModelRowAction, type ServerModelRow, type ServerModelsView } from './server-model-catalog';
import { useCatalogPolling } from './use-catalog-polling';

type Operation = ModelRowAction['kind'];

const OPERATIONS: Readonly<Record<Operation, (id: string) => Promise<ServerModelOutcome>>> = Object.freeze({
  download: (id) => window.codevo.serverModelDownload(id),
  retry: (id) => window.codevo.serverModelDownload(id),
  remove: (id) => window.codevo.serverModelRemove(id),
  cancel: (id) => window.codevo.serverModelCancel(id),
});

type RowHandlers = { pending: boolean; onAction: (action: ModelRowAction) => void };

function RemoveConfirm({ row, onCancel, onConfirm }: { row: ServerModelRow; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="confirm srv-model-confirm">
      <p>
        <b>Odstrániť {row.name} zo servera?</b> Súbor sa zo servera zmaže. Ak ho budete chcieť znova, treba ho stiahnuť ({row.size}).
      </p>
      <div className="row-btns">
        <button type="button" className="btn sm ghost" onClick={onCancel}>
          Ponechať
        </button>
        <button type="button" className="btn sm danger" onClick={onConfirm}>
          Áno, odstrániť
        </button>
      </div>
    </div>
  );
}

function RowAction({ row, pending, onAction }: { row: ServerModelRow } & RowHandlers) {
  if (row.badge !== null) {
    return <span className="chip">{row.badge}</span>;
  }
  if (row.action === null) {
    return null;
  }
  const action = row.action;
  return (
    <button type="button" className={action.kind === 'remove' ? 'btn sm danger' : 'btn sm'} disabled={action.disabled || pending} aria-label={`${action.label}: ${row.name}`} onClick={() => onAction(action)}>
      {action.label}
    </button>
  );
}

function ModelRowItem({ row, pending, onAction }: { row: ServerModelRow } & RowHandlers) {
  return (
    <li className="model" data-server-model={row.id}>
      <div className="model-info">
        <b>{row.name}</b>
        <span className="model-meta">
          <span>{row.size}</span>
          <span>{row.hint}</span>
          <span className={row.failed ? 'model-status warn' : 'model-status'}>{row.status}</span>
        </span>
        {row.percent !== null && (
          <span className="progress" role="progressbar" aria-label={`Sťahovanie: ${row.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.percent}>
            <i style={{ width: `${row.percent}%` }} />
          </span>
        )}
      </div>
      <RowAction row={row} pending={pending} onAction={onAction} />
    </li>
  );
}

function Notice({ notice }: { notice: CatalogNotice }) {
  const [checking, setChecking] = useState(false);

  function recheck(): void {
    setChecking(true);
    window.codevo
      .refreshServerModels()
      .catch((error: unknown) => console.error('Refreshing the server models failed', error))
      .finally(() => setChecking(false));
  }

  if (notice.command === null) {
    return <p className="field-note warn">{notice.text}</p>;
  }
  return (
    <div className="srv-models-notice">
      <p className="field-note">{notice.text}</p>
      <CommandBox command={notice.command} />
      <button type="button" className="btn sm ghost" disabled={checking} onClick={recheck}>
        Skontrolovať znova
      </button>
    </div>
  );
}

function ModelPanel({ view, id }: { view: ServerModelsView; id: string }) {
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run(row: ServerModelRow, operation: Operation): void {
    setConfirming(null);
    setPending(row.id);
    setMessage(null);
    OPERATIONS[operation](row.id)
      .then(
        (outcome) => setMessage(modelOutcomeMessage(outcome)),
        (error: unknown) => {
          console.error('The server model operation failed', error);
          setMessage(OPERATION_FAILED);
        },
      )
      .finally(() => setPending(null));
  }

  function act(row: ServerModelRow, action: ModelRowAction): void {
    if (action.kind === 'remove') {
      setConfirming(row.id);
      return;
    }
    run(row, action.kind);
  }

  const confirmed = view.rows.find((row) => row.id === confirming && row.action?.kind === 'remove');
  return (
    <section className="srv-models" id={id} aria-label="Modely na serveri">
      <h4>Modely na serveri</h4>
      {view.notice !== null && <Notice notice={view.notice} />}
      <ul className="models">
        {view.rows.map((row) => (
          <ModelRowItem key={row.id} row={row} pending={pending !== null} onAction={(action) => act(row, action)} />
        ))}
      </ul>
      {confirmed !== undefined && <RemoveConfirm row={confirmed} onCancel={() => setConfirming(null)} onConfirm={() => run(confirmed, 'remove')} />}
      {view.busyHint !== null && <p className="field-note">{view.busyHint}</p>}
      {message !== null && (
        <p className="field-note warn" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}

export function ServerModels({ server }: { server: PairedServerView }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const view = serverModelsView(server, navigator.userAgent.includes('Linux'));
  useCatalogPolling((view?.downloading ?? null) !== null);
  if (view === null) {
    return null;
  }
  return (
    <>
      <div className="srv-models-toggle">
        <button type="button" className="btn sm ghost" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}>
          {open ? 'Skryť modely' : 'Spravovať modely'}
        </button>
        {!open && view.downloading !== null && (
          <span className="field-note">
            Sťahuje sa {view.downloading.name}, {view.downloading.percent} %
          </span>
        )}
      </div>
      {open && <ModelPanel view={view} id={panelId} />}
    </>
  );
}
