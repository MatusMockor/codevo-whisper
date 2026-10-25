import { useState } from 'react';
import type { InstallOutcome } from '../../shared/updates';
import { SettingsRow } from './SettingsGroup';
import { updateRowView, type UpdateAction, type UpdateActionId } from './update-row';
import { useUpdateStatus } from './use-update-status';

const TITLE = 'Aktualizácie';

function report(message: string): (error: unknown) => void {
  return (error) => console.error(message, error);
}

function UpdateButton({ action, onClick }: { action: UpdateAction; onClick: (id: UpdateActionId) => void }) {
  return (
    <button type="button" className={action.primary ? 'btn primary' : 'btn'} disabled={action.disabled} onClick={() => onClick(action.id)}>
      {action.label}
    </button>
  );
}

export function UpdateRow() {
  const status = useUpdateStatus();
  const [notice, setNotice] = useState<InstallOutcome | null>(null);

  function act(id: UpdateActionId): void {
    if (id === 'install') {
      window.codevo.installUpdate().then(setNotice, report('Installing the update failed'));
      return;
    }
    setNotice(null);
    if (id === 'download') {
      window.codevo.openUpdateDownload().catch(report('Opening the download page failed'));
      return;
    }
    window.codevo.checkForUpdates().catch(report('Checking for updates failed'));
  }

  if (status.kind !== 'ready') {
    return <SettingsRow title={TITLE} description={status.kind === 'failed' ? 'Stav aktualizácií sa nepodarilo načítať.' : undefined}>{null}</SettingsRow>;
  }
  const view = updateRowView(status.value, notice);
  return (
    <SettingsRow title={TITLE} description={<span aria-live="polite">{view.description}</span>}>
      <div className="row-btns">
        {view.actions.map((action) => (
          <UpdateButton key={action.id} action={action} onClick={act} />
        ))}
      </div>
    </SettingsRow>
  );
}
