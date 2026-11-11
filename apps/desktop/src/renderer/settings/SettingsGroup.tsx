import { useId, type ReactNode } from 'react';
import type { SettingId, SettingsGroupId } from './settings-catalog';
import { SearchHighlight, useGroupVisible, useSettingsSearch, useSettingVisible } from './settings-search';

type SettingsGroupProps = { group: SettingsGroupId; tag?: string; children: ReactNode };

export function SettingsGroup({ group, tag, children }: SettingsGroupProps) {
  const id = useId();
  const entry = useSettingsSearch().groups.find((candidate) => candidate.id === group);
  const visible = useGroupVisible(group);
  if (entry === undefined) {
    return null;
  }
  return (
    <section className="set-group" aria-labelledby={id} data-section={group} hidden={!visible}>
      <header className="set-group-h">
        <span className="n" aria-hidden="true">
          {entry.index}
        </span>
        <h2 id={id} tabIndex={-1}>
          <SearchHighlight text={entry.title} />
        </h2>
        {tag !== undefined && <span className="chip">{tag}</span>}
      </header>
      <div className="set-rows">{children}</div>
    </section>
  );
}

export function SettingsLead({ children }: { children: ReactNode }) {
  const { terms } = useSettingsSearch();
  return (
    <p className="set-lead" hidden={terms.length > 0}>
      {children}
    </p>
  );
}

type SettingsBlockProps = { id?: SettingId | undefined; className?: string; children: ReactNode };

export function SettingsBlock({ id, className = 'set-block', children }: SettingsBlockProps) {
  return (
    <div className={className} data-setting={id} hidden={!useSettingVisible(id)}>
      {children}
    </div>
  );
}

type SettingsRowProps = { id?: SettingId; title: string; titleId?: string; description?: ReactNode; children: ReactNode };

export function SettingsRow({ id, title, titleId, description, children }: SettingsRowProps) {
  return (
    <SettingsBlock id={id} className="srow">
      <div className="t">
        <b id={titleId}>
          <SearchHighlight text={title} />
        </b>
        {description !== undefined && <span>{description}</span>}
      </div>
      {children}
    </SettingsBlock>
  );
}
