import { useEffect, useId, useRef, useState } from 'react';
import { LANGUAGE_NAMES, type DictationLanguage, type LanguageSelection } from '../../shared/dictation-languages';
import type { ModelInfo } from '../../shared/models';
import { SegmentedControl } from '../components/SegmentedControl';
import {
  LANGUAGE_EDIT_ERRORS,
  LANGUAGE_MODE_DESCRIPTIONS,
  languageModeOptions,
  MEETINGS_LANGUAGE_NOTE,
  requiredLanguageNote,
  showsSingleLanguageHint,
  SINGLE_LANGUAGE_HINT,
} from './language-options';
import { canMove, moveLanguage, toggleLanguage, unselectedLanguages, type LanguageEditError, type MoveDirection } from './language-selection';
import { SettingsRow } from './SettingsGroup';
import { saveSettings } from './use-settings';

type PickerProps = { languages: LanguageSelection; activeModel: ModelInfo | null };

type FocusRequest = { ids: readonly string[]; from: string };

const OPPOSITE: Readonly<Record<MoveDirection, MoveDirection>> = { up: 'down', down: 'up' };

function focusFirstEnabled(ids: readonly string[]): void {
  const target = ids.map((id) => document.getElementById(id)).find((element) => (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && !element.disabled);
  target?.focus();
}

function LanguagePicker({ languages, activeModel }: PickerProps) {
  const baseId = useId();
  const [error, setError] = useState<LanguageEditError | null>(null);
  const focusRequest = useRef<FocusRequest | null>(null);
  const { selected } = languages;
  const order = selected.join(',');
  const requiredNote = requiredLanguageNote(activeModel);
  const checkId = (code: DictationLanguage) => `${baseId}-${code}`;
  const moveId = (code: DictationLanguage, direction: MoveDirection) => `${baseId}-${code}-${direction}`;

  useEffect(() => {
    const request = focusRequest.current;
    if (request === null || request.from === order) {
      return;
    }
    focusRequest.current = null;
    focusFirstEnabled(request.ids);
  }, [order]);

  function toggle(code: DictationLanguage): void {
    const edit = toggleLanguage(selected, code);
    if (!edit.ok) {
      setError(edit.error);
      return;
    }
    setError(null);
    focusRequest.current = { ids: [checkId(code)], from: order };
    saveSettings({ languages: { mode: 'selected', selected: edit.selected } });
  }

  function move(code: DictationLanguage, direction: MoveDirection): void {
    setError(null);
    focusRequest.current = { ids: [moveId(code, direction), moveId(code, OPPOSITE[direction])], from: order };
    saveSettings({ languages: { mode: 'selected', selected: moveLanguage(selected, code, direction) } });
  }

  return (
    <div className="lang-pick">
      <ol className="lang-chosen" aria-label="Zvolené jazyky">
        {selected.map((code, index) => (
          <li key={code} data-language={code}>
            <label>
              <input id={checkId(code)} type="checkbox" checked onChange={() => toggle(code)} />
              {LANGUAGE_NAMES[code]}
            </label>
            {index === 0 && <span className="chip">Hlavný</span>}
            <span className="lang-move">
              <button id={moveId(code, 'up')} type="button" className="btn sm" aria-label={`Vyššie: ${LANGUAGE_NAMES[code]}`} disabled={!canMove(selected, code, 'up')} onClick={() => move(code, 'up')}>
                Vyššie
              </button>
              <button id={moveId(code, 'down')} type="button" className="btn sm" aria-label={`Nižšie: ${LANGUAGE_NAMES[code]}`} disabled={!canMove(selected, code, 'down')} onClick={() => move(code, 'down')}>
                Nižšie
              </button>
            </span>
          </li>
        ))}
      </ol>
      <ul className="lang-more" aria-label="Ďalšie jazyky">
        {unselectedLanguages(selected).map((code) => (
          <li key={code} data-language={code}>
            <label>
              <input id={checkId(code)} type="checkbox" checked={false} onChange={() => toggle(code)} />
              {LANGUAGE_NAMES[code]}
            </label>
          </li>
        ))}
      </ul>
      {error !== null && (
        <p className="field-note warn" role="alert">
          {LANGUAGE_EDIT_ERRORS[error]}
        </p>
      )}
      {showsSingleLanguageHint(languages) && <p className="field-note">{SINGLE_LANGUAGE_HINT}</p>}
      {requiredNote !== null && <p className="field-note">{requiredNote}</p>}
      <p className="field-note">{MEETINGS_LANGUAGE_NOTE}</p>
    </div>
  );
}

export function DictationLanguagesRow({ languages, activeModel }: PickerProps) {
  return (
    <SettingsRow id="languages" title="Jazyky diktovania" description={LANGUAGE_MODE_DESCRIPTIONS[languages.mode]}>
      <SegmentedControl label="Jazyky diktovania" options={languageModeOptions(activeModel?.languageHint ?? null)} value={languages.mode} onChange={(mode) => saveSettings({ languages: { ...languages, mode } })} />
      {languages.mode === 'selected' && <LanguagePicker languages={languages} activeModel={activeModel} />}
    </SettingsRow>
  );
}
