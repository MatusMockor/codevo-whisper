import { CheckIcon, WarnIcon } from '../components/Icons';

type PermissionRowProps = { title: string; description: string; granted: boolean; statusLabel: string; actionLabel: string; onAction: () => void };

export function PermissionRow({ title, description, granted, statusLabel, actionLabel, onAction }: PermissionRowProps) {
  return (
    <div className="srow perm" data-granted={granted}>
      <span className={granted ? 'orb done' : 'orb warn'}>{granted ? <CheckIcon /> : <WarnIcon />}</span>
      <div className="t">
        <b>{title}</b>
        <span>{description}</span>
      </div>
      <span className={granted ? 'perm-status ok' : 'perm-status'} aria-live="polite">
        {statusLabel}
      </span>
      {!granted && (
        <button type="button" className="btn" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
