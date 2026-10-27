import { useState } from 'react';
import type { InstallOutcome } from '../../shared/updates';
import { useUpdateStatus } from '../settings/use-update-status';
import { updateIndicatorView, type UpdateIndicatorActionId, type UpdateIndicatorView } from './update-indicator';

function report(message: string): (error: unknown) => void {
  return (error) => console.error(message, error);
}

function IndicatorBody({ view, onAct }: { view: UpdateIndicatorView; onAct: (id: UpdateIndicatorActionId) => void }) {
  const { action, percent } = view;
  return (
    <>
      {percent !== null && (
        <span className="progress" aria-hidden="true">
          <i style={{ width: `${percent}%` }} />
        </span>
      )}
      {action !== null && (
        <button type="button" className="btn primary" disabled={action.disabled} onClick={() => onAct(action.id)}>
          {action.label}
        </button>
      )}
    </>
  );
}

export function UpdateIndicator() {
  const status = useUpdateStatus();
  const [notice, setNotice] = useState<InstallOutcome | null>(null);
  const view = status.kind === 'ready' ? updateIndicatorView(status.value, notice) : null;

  function act(id: UpdateIndicatorActionId): void {
    if (id === 'install') {
      window.codevo.installUpdate().then(setNotice, report('Installing the update failed'));
      return;
    }
    setNotice(null);
    window.codevo.openUpdateDownload().catch(report('Opening the download page failed'));
  }

  return (
    <div className={view === null ? 'side-update' : 'side-update shown'}>
      <p className="side-update-text" aria-live="polite">
        {view?.message}
        {view !== null && view.note !== null && <span className="side-update-note">{view.note}</span>}
      </p>
      {view !== null && <IndicatorBody view={view} onAct={act} />}
    </div>
  );
}
