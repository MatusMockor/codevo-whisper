import { revealSection } from '../components/use-reveal-section';
import { ENGINE_SECTION, type NavTarget } from '../navigation';
import type { SettingsFilter, SettingsGroupEntry, SettingsGroupId } from './settings-catalog';

type SettingsIndexProps = {
  groups: readonly SettingsGroupEntry[];
  filter: SettingsFilter | null;
  active: SettingsGroupId | null;
  onNavigate: (target: NavTarget) => void;
};

export function SettingsIndex({ groups, filter, active, onNavigate }: SettingsIndexProps) {
  return (
    <nav className="set-idx" aria-label="Sekcie nastavení">
      <ol>
        {groups.map((group) => (
          <li key={group.id} hidden={filter !== null && !filter.groups.has(group.id)}>
            <button type="button" aria-current={group.id === active ? 'true' : undefined} onClick={() => revealSection(group.id)}>
              <span className="n" aria-hidden="true">
                {group.index}
              </span>
              {group.title}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="set-moved" onClick={() => onNavigate(ENGINE_SECTION)}>
        <b>
          Kde beží prepis <span aria-hidden="true">→</span>
        </b>
        <span>Server, poradie prepisu a lokálny model sú na stránke Prepis.</span>
      </button>
    </nav>
  );
}
