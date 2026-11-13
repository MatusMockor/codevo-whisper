import { useId, useState } from 'react';
import { formatCustomWords, isCustomWords, parseCustomWords } from '../../shared/custom-words';
import type { Settings } from '../../shared/settings';
import { Switch } from '../components/Switch';
import { SettingsBlock, SettingsGroup, SettingsRow } from './SettingsGroup';
import { SearchHighlight } from './settings-search';
import { saveSettings } from './use-settings';

export function TranscriptSection({ settings }: { settings: Settings }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? formatCustomWords(settings.customWords);

  function saveWords(): void {
    const words = parseCustomWords(value);
    if (!isCustomWords(words)) {
      setError('Zadajte jeden výraz na riadok, najviac 100 výrazov a 10 variantov k výrazu, každý do 64 znakov. Výraz tvoria slová z písmen a číslic s vnútorným apostrofom, spojovníkom alebo bodkou. Varianty napíšte za dvojbodku a oddeľte ich čiarkou.');
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
          <span id={`${id}-hint`}>Jeden výraz na riadok v požadovanom pravopise, aj viacslovný. Za dvojbodku pridajte vyslovované varianty oddelené čiarkou, napríklad: Kumiba MCP: kumiba em si pí</span>
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
