import type { InsertionMode } from '../../shared/settings';
import { SettingsGroup } from './SettingsGroup';
import { saveSettings } from './use-settings';

const OPTIONS: ReadonlyArray<{ id: InsertionMode; title: string; description: string }> = [
  { id: 'paste', title: 'Vložiť do aktívnej aplikácie', description: 'Text sa objaví na mieste kurzora. Obsah schránky sa po vložení vráti späť.' },
  { id: 'clipboard', title: 'Iba skopírovať do schránky', description: 'Vložíte si ho sami cez ⌘V, keď budete chcieť.' },
];

export function InsertionSection({ insertion }: { insertion: InsertionMode }) {
  return (
    <SettingsGroup title="Vkladanie textu">
      <div className="radio" role="radiogroup" aria-label="Spôsob vkladania">
        {OPTIONS.map((option) => (
          <label key={option.id}>
            <input
              type="radio"
              name="insertion"
              checked={insertion === option.id}
              onChange={() => {
                saveSettings({ insertion: option.id });
              }}
            />
            <div>
              <b>{option.title}</b>
              <span>{option.description}</span>
            </div>
          </label>
        ))}
      </div>
    </SettingsGroup>
  );
}
