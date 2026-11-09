import { useUpdateStatus } from '../settings/use-update-status';
import { CheckUpdatesButton } from './CheckUpdatesButton';
import { updateFooterView, updateRailView } from './update-footer';

export function RailVersion() {
  const status = useUpdateStatus();
  if (status.kind !== 'ready') {
    return null;
  }
  const rail = updateRailView(status.value);
  return (
    <div className="rail-foot">
      <p className="rail-ver" aria-hidden="true">
        {rail.version}
        {rail.result !== null && <span>{rail.result}</span>}
      </p>
      <CheckUpdatesButton view={updateFooterView(status.value)} className="iconbtn" />
    </div>
  );
}

export function StatusBarVersion() {
  const status = useUpdateStatus();
  if (status.kind !== 'ready') {
    return null;
  }
  const view = updateFooterView(status.value);
  return (
    <div className="sbar-version">
      <span aria-live="polite">
        {view.version}
        {view.result !== null && <span className="sbar-result"> · {view.result}</span>}
      </span>
      <CheckUpdatesButton view={view} className="sbar-btn" />
    </div>
  );
}
