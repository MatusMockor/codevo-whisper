import { Fragment, useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { isDictationLanguage, LANGUAGE_NAMES, MAX_SELECTED_LANGUAGES, type DictationLanguage, type LanguageSelection } from '../../shared/dictation-languages';
import type { ModelInfo } from '../../shared/models';
import { SegmentedControl } from '../components/SegmentedControl';
import {
  LANGUAGE_EDIT_ERRORS,
  LANGUAGE_MODE_DESCRIPTIONS,
  languageChangeNotice,
  languageModeOptions,
  languageRowLabel,
  MEETINGS_LANGUAGE_NOTE,
  NO_MATCHING_LANGUAGE,
  requiredLanguageNote,
  SINGLE_LANGUAGE_HINT,
} from './language-options';
import {
  addLanguage,
  availableLanguages,
  beginSave,
  effectiveSelection,
  moveLanguage,
  removeLanguage,
  settleSave,
  shiftLanguage,
  type PendingSelection,
} from './language-selection';
import { SettingsRow } from './SettingsGroup';
import { saveSettings } from './use-settings';

type Zone = 'used' | 'available';

type Dragged = { code: DictationLanguage; from: Zone };

type Notice = { text: string; warn: boolean };

type FocusTarget = { zone: Zone; code: DictationLanguage };

type BoardProps = { selected: readonly DictationLanguage[]; activeModel: ModelInfo | null; onChange: (selected: readonly DictationLanguage[]) => void };

const ARROWS: Readonly<Record<string, 'up' | 'down'>> = Object.freeze({ ArrowUp: 'up', ArrowDown: 'down' });

const GRIP_DOTS = [0, 1, 2, 3, 4, 5];

function draggedCode(event: DragEvent): DictationLanguage | null {
  const code = event.dataTransfer.getData('text/plain');
  return isDictationLanguage(code) ? code : null;
}

function leftZone(event: DragEvent<HTMLElement>): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX <= box.left || event.clientX >= box.right || event.clientY <= box.top || event.clientY >= box.bottom;
}

function LanguageBoard({ selected, activeModel, onChange }: BoardProps) {
  const footId = useId();
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dragging, setDragging] = useState<DictationLanguage | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [over, setOver] = useState<Zone | null>(null);
  const usedList = useRef<HTMLOListElement>(null);
  const chipList = useRef<HTMLDivElement>(null);
  const dragged = useRef<Dragged | null>(null);
  const focusTarget = useRef<FocusTarget | null>(null);
  const order = selected.join(',');
  const available = availableLanguages(selected, query);
  const full = selected.length >= MAX_SELECTED_LANGUAGES;
  const requiredNote = requiredLanguageNote(activeModel);

  useLayoutEffect(() => {
    const target = focusTarget.current;
    if (target === null) {
      return;
    }
    focusTarget.current = null;
    const container = target.zone === 'used' ? usedList.current : chipList.current;
    container?.querySelector<HTMLElement>(`[data-code="${target.code}"]`)?.focus();
  }, [order]);

  function warn(text: string): void {
    setNotice({ text, warn: true });
  }

  function add(code: DictationLanguage, at?: number): boolean {
    const edit = addLanguage(selected, code, at);
    if (!edit.ok) {
      warn(LANGUAGE_EDIT_ERRORS[edit.error]);
      return false;
    }
    setNotice({ text: languageChangeNotice(code, 'added'), warn: false });
    onChange(edit.selected);
    return true;
  }

  function remove(code: DictationLanguage): readonly DictationLanguage[] | null {
    const edit = removeLanguage(selected, code);
    if (!edit.ok) {
      warn(LANGUAGE_EDIT_ERRORS[edit.error]);
      return null;
    }
    setNotice({ text: languageChangeNotice(code, 'removed'), warn: false });
    onChange(edit.selected);
    return edit.selected;
  }

  function addFromChip(code: DictationLanguage): void {
    const index = available.indexOf(code);
    const rest = available.filter((language) => language !== code);
    if (!add(code)) {
      return;
    }
    const next = rest[Math.min(index, rest.length - 1)];
    focusTarget.current = next === undefined ? { zone: 'used', code } : { zone: 'available', code: next };
  }

  function removeByButton(code: DictationLanguage): void {
    const index = selected.indexOf(code);
    const next = remove(code);
    const target = next?.[Math.min(index, next.length - 1)];
    if (target === undefined) {
      return;
    }
    focusTarget.current = { zone: 'used', code: target };
  }

  function shiftByKey(event: KeyboardEvent<HTMLLIElement>, code: DictationLanguage): void {
    const direction = ARROWS[event.key];
    if (!event.altKey || direction === undefined) {
      return;
    }
    event.preventDefault();
    const next = shiftLanguage(selected, code, direction);
    if (next.join(',') === order) {
      return;
    }
    focusTarget.current = { zone: 'used', code };
    onChange(next);
  }

  function startDrag(event: DragEvent, code: DictationLanguage, from: Zone): void {
    event.dataTransfer.setData('text/plain', code);
    event.dataTransfer.effectAllowed = from === 'used' ? 'move' : 'copyMove';
    dragged.current = { code, from };
    requestAnimationFrame(() => {
      if (dragged.current?.code === code) setDragging(code);
    });
  }

  function endDrag(): void {
    dragged.current = null;
    setDragging(null);
    setDropIndex(null);
    setOver(null);
  }

  function insertionIndex(clientY: number): number {
    const rows = [...(usedList.current?.querySelectorAll<HTMLElement>('.lang-item') ?? [])];
    const hit = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return clientY < box.top + box.height / 2;
    });
    return hit < 0 ? rows.length : hit;
  }

  function dragOverUsed(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setOver('used');
    setDropIndex(insertionIndex(event.clientY));
  }

  function dropOnUsed(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    const code = draggedCode(event);
    const at = insertionIndex(event.clientY);
    endDrag();
    if (code === null) {
      return;
    }
    if (selected.includes(code)) {
      onChange(moveLanguage(selected, code, at));
      return;
    }
    add(code, at);
  }

  function dragOverAvailable(event: DragEvent<HTMLElement>): void {
    if (dragged.current?.from !== 'used') {
      return;
    }
    event.preventDefault();
    setOver('available');
  }

  function dropOnAvailable(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    const code = draggedCode(event);
    endDrag();
    if (code === null || !selected.includes(code)) {
      return;
    }
    remove(code);
  }

  function leave(event: DragEvent<HTMLElement>): void {
    if (!leftZone(event)) {
      return;
    }
    setOver(null);
    setDropIndex(null);
  }

  const dropLine = <li className="lang-drop" aria-hidden="true" />;

  return (
    <div className="lang-board">
      <section className={over === 'used' ? 'lang-zone over' : 'lang-zone'} aria-label="Používané jazyky" onDragOver={dragOverUsed} onDragLeave={leave} onDrop={dropOnUsed}>
        <div className="lang-zone-h">
          <b>Používané</b>
          <span className={full ? 'lang-count full' : 'lang-count'}>{`${selected.length} / ${MAX_SELECTED_LANGUAGES}`}</span>
        </div>
        <ol className="lang-used" ref={usedList} aria-describedby={footId}>
          {selected.map((code, index) => (
            <Fragment key={code}>
              {dropIndex === index && dropLine}
              <li
                className={['lang-item', index === 0 ? 'primary' : '', dragging === code ? 'dragging' : ''].filter((name) => name !== '').join(' ')}
                draggable
                tabIndex={0}
                data-code={code}
                aria-label={languageRowLabel(code, index)}
                onKeyDown={(event) => shiftByKey(event, code)}
                onDragStart={(event) => startDrag(event, code, 'used')}
                onDragEnd={endDrag}
              >
                <span className="lang-grip" aria-hidden="true">
                  {GRIP_DOTS.map((dot) => (
                    <i key={dot} />
                  ))}
                </span>
                <span className="lang-rank">{index + 1}</span>
                <span className="lang-code">{code.toUpperCase()}</span>
                <span className="lang-name">{LANGUAGE_NAMES[code]}</span>
                {index === 0 && <span className="lang-badge">Hlavný</span>}
                <button type="button" className="lang-remove" aria-label={`Odobrať ${LANGUAGE_NAMES[code]}`} disabled={selected.length === 1} onClick={() => removeByButton(code)}>
                  ×
                </button>
              </li>
            </Fragment>
          ))}
          {dropIndex === selected.length && dropLine}
          {Array.from({ length: MAX_SELECTED_LANGUAGES - selected.length }, (_, slot) => (
            <li key={`slot-${slot}`} className="lang-slot" aria-hidden="true">
              {slot === 0 ? 'Pretiahnite sem jazyk' : ''}
            </li>
          ))}
        </ol>
      </section>
      <section className={over === 'available' ? 'lang-zone over' : 'lang-zone'} aria-label="Ďalšie jazyky" onDragOver={dragOverAvailable} onDragLeave={leave} onDrop={dropOnAvailable}>
        <div className="lang-zone-h">
          <b>Ďalšie jazyky</b>
          <span className="lang-count">pretiahnite hore alebo kliknite</span>
        </div>
        <label className="lang-search">
          <span aria-hidden="true">⌕</span>
          <input type="text" value={query} placeholder="Hľadať jazyk…" aria-label="Hľadať jazyk" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="lang-chips" ref={chipList}>
          {available.length === 0 && <p className="lang-empty">{NO_MATCHING_LANGUAGE}</p>}
          {available.map((code) => (
            <button
              key={code}
              type="button"
              className="lang-chip"
              draggable
              data-code={code}
              aria-disabled={full}
              aria-label={`Pridať ${LANGUAGE_NAMES[code]}`}
              onClick={() => addFromChip(code)}
              onDragStart={(event) => startDrag(event, code, 'available')}
              onDragEnd={endDrag}
            >
              <span className="lang-code">{code.toUpperCase()}</span>
              {LANGUAGE_NAMES[code]}
              <span className="lang-plus" aria-hidden="true">
                +
              </span>
            </button>
          ))}
        </div>
        <p className={notice?.warn === true ? 'lang-notice warn' : 'lang-notice'} role="status">
          {notice?.text ?? ''}
        </p>
      </section>
      {selected.length === 1 && <p className="field-note">{SINGLE_LANGUAGE_HINT}</p>}
      {requiredNote !== null && <p className="field-note">{requiredNote}</p>}
      <p className="lang-foot" id={footId}>
        Poradie zmeníte potiahnutím alebo klávesmi <kbd>Alt</kbd> + <kbd>↑</kbd> <kbd>↓</kbd>. Jazyk odoberiete krížikom alebo potiahnutím späť dole. {MEETINGS_LANGUAGE_NOTE}
      </p>
    </div>
  );
}

export function DictationLanguagesRow({ languages, activeModel }: { languages: LanguageSelection; activeModel: ModelInfo | null }) {
  const [pending, setPending] = useState<PendingSelection>(null);
  const effective = effectiveSelection(pending, languages);

  function save(next: LanguageSelection): void {
    setPending((current) => beginSave(current, next));
    saveSettings({ languages: next }, (saved) => setPending((current) => settleSave(current, saved)));
  }

  return (
    <SettingsRow id="languages" title="Jazyky diktovania" description={LANGUAGE_MODE_DESCRIPTIONS[effective.mode]}>
      <SegmentedControl label="Jazyky diktovania" options={languageModeOptions(activeModel?.languageHint ?? null)} value={effective.mode} onChange={(mode) => save({ ...effective, mode })} />
      {effective.mode === 'selected' && <LanguageBoard selected={effective.selected} activeModel={activeModel} onChange={(selected) => save({ mode: 'selected', selected })} />}
    </SettingsRow>
  );
}
