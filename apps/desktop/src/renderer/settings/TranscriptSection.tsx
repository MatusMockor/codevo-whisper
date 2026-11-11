import { useId, useState } from 'react';
import { isCustomWords, type Settings } from '../../shared/settings';
import { Switch } from '../components/Switch';
import { SettingsBlock, SettingsGroup, SettingsRow } from './SettingsGroup';
import { SearchHighlight } from './settings-search';
import { saveSettings } from './use-settings';

export function TranscriptSection({ settings }: { settings: Settings }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? settings.customWords.join('\n');

  function saveWords(): void {
    const seen = new Set<string>();
    const words = value.split(/\r?\n/u).map((line) => line.trim().normalize('NFC')).filter((word) => {
      const key = word.toLowerCase();
      if (key === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!isCustomWords(words)) {
      setError('Zadajte jedno slovo na riadok, najviac 100 slov po 64 znakov. Povolené sú písmená, číslice a vnútorný apostrof, spojovník alebo bodka.');
      return;
    }
    setSaving(true);
    saveSettings({ customWords: words }, (saved) => {
      setSaving(false);
      if (saved) setDraft(null);
      setError(saved ? null : 'Slová sa nepodarilo uložiť. Skúste to znova.');
    });
  }

  return (
    <SettingsGroup group="transcript">
      <SettingsBlock id="custom-words" className="srow">
        <div className="t">
          <label htmlFor={id}>
            <SearchHighlight text="Vlastné slová" />
          </label>
          <span id={`${id}-hint`}>Jedno slovo na riadok, najviac 100 slov po 64 znakov. Použite požadovaný pravopis mien a odborných výrazov.</span>
        </div>
        <div className="words-ctl">
          <textarea
            id={id}
            rows={5}
            value={value}
            disabled={saving}
            aria-describedby={`${id}-hint${error === null ? '' : ` ${id}-error`}`}
            aria-invalid={error !== null}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
          />
          {error !== null && <p id={`${id}-error`} className="field-note warn" role="alert">{error}</p>}
          <button type="button" className="btn" disabled={saving || draft === null} onClick={saveWords}>
            {saving ? 'Ukladá sa…' : 'Uložiť slová'}
          </button>
        </div>
      </SettingsBlock>
      <SettingsRow id="filler-words" title="Odstrániť výplňové slová" description="Vynechá zaváhania ako ehm, eee, hmm, um a uh z hotového prepisu.">
        <Switch label="Odstrániť výplňové slová" checked={settings.removeFillerWords} onChange={(checked) => saveSettings({ removeFillerWords: checked })} />
      </SettingsRow>
      <SettingsRow id="trailing-space" title="Pridať medzeru na konci" description="Za neprázdny prepis pridá jednu medzeru pre plynulé pokračovanie v písaní.">
        <Switch label="Pridať medzeru na konci" checked={settings.appendTrailingSpace} onChange={(checked) => saveSettings({ appendTrailingSpace: checked })} />
      </SettingsRow>
    </SettingsGroup>
  );
}
