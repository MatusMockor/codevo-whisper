import { useId, type ReactNode } from 'react';

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="sgroup" aria-labelledby={id} data-section={title}>
      <h2 id={id} tabIndex={-1}>
        {title}
      </h2>
      <div className="sbox">{children}</div>
    </section>
  );
}

type SettingsRowProps = { title: string; titleId?: string; description?: ReactNode; children: ReactNode };

export function SettingsRow({ title, titleId, description, children }: SettingsRowProps) {
  return (
    <div className="srow">
      <div className="t">
        <b id={titleId}>{title}</b>
        {description !== undefined && <span>{description}</span>}
      </div>
      {children}
    </div>
  );
}
