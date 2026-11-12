type PermissionRowProps = { title: string; description: string; granted: boolean; statusLabel: string; actionLabel: string; onAction: () => void; busy?: boolean };

export function PermissionRow({ title, description, granted, statusLabel, actionLabel, onAction, busy = false }: PermissionRowProps) {
  return (
    <div className="srow perm" data-granted={granted}>
      <span className={granted ? 'led ok' : 'led err'} aria-hidden="true" />
      <div className="t">
        <b>{title}</b>
        <span>{description}</span>
      </div>
      <span className={granted ? 'pill ok' : 'pill err'} aria-live="polite">
        {statusLabel}
      </span>
      {!granted && (
        <button type="button" className="btn sm primary" onClick={onAction} disabled={busy}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
