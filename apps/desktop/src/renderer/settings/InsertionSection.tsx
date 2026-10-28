import type { AutoSubmit, ClipboardPolicy, InsertionMode, Settings } from '../../shared/settings';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { saveSettings } from './use-settings';

const OPTIONS: ReadonlyArray<{ id: InsertionMode; title: string; description: string }> = [
  { id: 'paste', title: 'Vložiť do aktívnej aplikácie', description: 'Text sa vloží cez schránku. Jej obsah sa podľa zvolenej možnosti obnoví alebo zostane prepis.' },
  { id: 'type', title: 'Priame písanie', description: 'Text sa napíše priamo na mieste kurzora bez použitia skratky na vloženie.' },
  { id: 'clipboard', title: 'Iba skopírovať do schránky', description: 'Vložíte si ho sami cez ⌘V, keď budete chcieť.' },
];

const CLIPBOARD_OPTIONS: ReadonlyArray<{ id: ClipboardPolicy; label: string }> = [
  { id: 'restore', label: 'Nemeniť schránku' },
  { id: 'leave', label: 'Nechať prepis v schránke' },
];

const SUBMIT_OPTIONS: ReadonlyArray<{ id: AutoSubmit; label: string }> = [
  { id: 'off', label: 'Vypnuté' },
  { id: 'enter', label: 'Enter' },
  { id: 'primary-enter', label: 'Cmd+Enter / Ctrl+Enter' },
];

const CLIPBOARD_DESCRIPTIONS: Readonly<Record<InsertionMode, string>> = {
  clipboard: 'Kopírovanie vždy nechá prepis v schránke.',
  paste: 'Pri vkladaní sa schránka dočasne použije. Pri možnosti Nemeniť schránku sa jej pôvodný obsah obnoví.',
  type: 'Priame písanie pri možnosti Nemeniť schránku schránku vôbec nepoužíva.',
};

export function InsertionSection({ settings }: { settings: Pick<Settings, 'insertion' | 'clipboardPolicy' | 'autoSubmit'> }) {
  const { insertion, clipboardPolicy, autoSubmit } = settings;
  const copying = insertion === 'clipboard';
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
      <SettingsRow title="Schránka" titleId="set-clipboard-policy" description={CLIPBOARD_DESCRIPTIONS[insertion]}>
        <select
          className="select"
          aria-labelledby="set-clipboard-policy"
          value={clipboardPolicy}
          disabled={copying}
          onChange={(event) => {
            const next = CLIPBOARD_OPTIONS.find((option) => option.id === event.target.value);
            if (next) saveSettings({ clipboardPolicy: next.id });
          }}
        >
          {CLIPBOARD_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </SettingsRow>
      <SettingsRow title="Automatické odoslanie" titleId="set-auto-submit" description="Po vložení textu stlačí zvolenú skratku. Cmd+Enter na Macu, Ctrl+Enter na Linuxe.">
        <select
          className="select"
          aria-labelledby="set-auto-submit"
          value={autoSubmit}
          disabled={copying}
          onChange={(event) => {
            const next = SUBMIT_OPTIONS.find((option) => option.id === event.target.value);
            if (next) saveSettings({ autoSubmit: next.id });
          }}
        >
          {SUBMIT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </SettingsRow>
    </SettingsGroup>
  );
}
