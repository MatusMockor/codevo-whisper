import { useUpdateStatus } from '../settings/use-update-status';
import { RefreshIcon } from './Icons';
import { updateFooterView } from './update-footer';

function check(): void {
  window.codevo.checkForUpdates().catch((error: unknown) => console.error('Checking for updates failed', error));
}

export function UpdateFooter() {
  const status = useUpdateStatus();
  if (status.kind !== 'ready') {
    return null;
  }
  const view = updateFooterView(status.value);
  return (
    <div className="side-foot">
      <p className="side-foot-text" aria-live="polite">
        {view.version}
        {view.result !== null && <span className="side-foot-result">{view.result}</span>}
      </p>
      <button type="button" className="side-foot-btn" aria-label="Skontrolovať aktualizácie" title={view.title} aria-busy={view.checking} disabled={view.disabled} onClick={check}>
        <RefreshIcon />
      </button>
    </div>
  );
}
