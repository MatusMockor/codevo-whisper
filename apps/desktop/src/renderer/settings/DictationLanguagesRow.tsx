import { Fragment, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { LANGUAGE_NAMES, MAX_SELECTED_LANGUAGES, type DictationLanguage, type LanguageSelection } from '../../shared/dictation-languages';
import type { ModelInfo } from '../../shared/models';
import type { EngineId } from '../../shared/settings';
import { insertionIndex, regionAt, type Point } from '../components/pointer-drag';
import { SegmentedControl } from '../components/SegmentedControl';
import { usePointerDrag, type ActiveDrag } from '../components/use-pointer-drag';
import { liveValueOr } from '../home/live-value';
import { useServer } from '../server/use-server';
import { serverAvailabilityNote, type AvailabilityNote } from './language-availability';
import { LanguagePackNote } from './LanguagePackNote';
import { acceptsDrop, languageDropPlan, type LanguageDragSource, type LanguageDropTarget, type LanguageZone } from './language-drop';
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

type Zone = LanguageZone;

type Source = LanguageDragSource<DictationLanguage>;

type Notice = { text: string; warn: boolean };

type FocusTarget = { zone: Zone; code: DictationLanguage };

type BoardProps = {
  selected: readonly DictationLanguage[];
  activeModel: ModelInfo | null;
  engineOrder: readonly EngineId[];
  availability: AvailabilityNote | null;
  onChange: (selected: readonly DictationLanguage[]) => void;
};

const ARROWS: Readonly<Record<string, 'up' | 'down'>> = Object.freeze({ ArrowUp: 'up', ArrowDown: 'down' });

const GRIP_DOTS = [0, 1, 2, 3, 4, 5];

function DragPreview({ drag }: { drag: ActiveDrag<Source, LanguageDropTarget> }) {
  const { code } = drag.source;
  const style = { width: drag.width, transform: `translate(${drag.pointer.x - drag.grab.x}px, ${drag.pointer.y - drag.grab.y}px)` };
  return createPortal(
    <div className="lang-ghost" style={style} aria-hidden="true">
      <span className="lang-code">{code.toUpperCase()}</span>
      <span className="lang-name">{LANGUAGE_NAMES[code]}</span>
    </div>,
    document.body,
  );
}

function startsOnRemove(event: PointerEvent<HTMLElement>): boolean {
  return event.target instanceof Element && event.target.closest('.lang-remove') !== null;
}

function LanguageBoard({ selected, activeModel, engineOrder, availability, onChange }: BoardProps) {
  const footId = useId();
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const usedZone = useRef<HTMLElement>(null);
  const availableZone = useRef<HTMLElement>(null);
  const usedList = useRef<HTMLOListElement>(null);
  const chipList = useRef<HTMLDivElement>(null);
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

  function resolve(point: Point): LanguageDropTarget {
    const zone = regionAt(point, [
      { id: 'used' as const, box: usedZone.current?.getBoundingClientRect() ?? null },
      { id: 'available' as const, box: availableZone.current?.getBoundingClientRect() ?? null },
    ]);
    const rows = [...(usedList.current?.querySelectorAll<HTMLElement>('.lang-item') ?? [])].map((row) => row.getBoundingClientRect());
    return { zone, index: insertionIndex(rows, point.y) };
  }

  function drop(source: Source, target: LanguageDropTarget): void {
    const plan = languageDropPlan(source, target);
    if (plan.kind === 'move') {
      onChange(moveLanguage(selected, source.code, plan.at));
      return;
    }
    if (plan.kind === 'add') {
      add(source.code, plan.at);
      return;
    }
    if (plan.kind === 'remove') {
      remove(source.code);
    }
  }

  const drag = usePointerDrag<Source, LanguageDropTarget>({ resolve, drop });
  const active = drag.active;
  const dropIndex = active?.target.zone === 'used' ? active.target.index : null;
  const over = active !== null && acceptsDrop(active.source, active.target.zone) ? active.target.zone : null;
  const draggedCode = active?.source.code ?? null;

  function zoneClass(zone: Zone): string {
    return over === zone ? 'lang-zone over' : 'lang-zone';
  }

  const dropLine = <li className="lang-drop" aria-hidden="true" />;

  return (
    <div className={active === null ? 'lang-board' : 'lang-board dragging'}>
      <section ref={usedZone} className={zoneClass('used')} aria-label="Používané jazyky">
        <div className="lang-zone-h">
          <b>Používané</b>
          <span className={full ? 'lang-count full' : 'lang-count'}>{`${selected.length} / ${MAX_SELECTED_LANGUAGES}`}</span>
        </div>
        <ol className="lang-used" ref={usedList} aria-describedby={footId}>
          {selected.map((code, index) => (
            <Fragment key={code}>
              {dropIndex === index && dropLine}
              <li
                className={['lang-item', index === 0 ? 'primary' : '', draggedCode === code ? 'dragging' : ''].filter((name) => name !== '').join(' ')}
                tabIndex={0}
                data-code={code}
                aria-label={languageRowLabel(code, index)}
                onKeyDown={(event) => shiftByKey(event, code)}
                onPointerDown={(event) => {
                  if (startsOnRemove(event)) return;
                  drag.begin(event, { code, from: 'used' });
                }}
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
      <section ref={availableZone} className={zoneClass('available')} aria-label="Ďalšie jazyky">
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
              className={draggedCode === code ? 'lang-chip dragging' : 'lang-chip'}
              data-code={code}
              aria-disabled={full}
              aria-label={`Pridať ${LANGUAGE_NAMES[code]}`}
              onPointerDown={(event) => drag.begin(event, { code, from: 'available' })}
              onClick={(event) => {
                if (!drag.allowsClick(event)) return;
                addFromChip(code);
              }}
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
      {availability !== null && <p className={availability.warn ? 'field-note warn' : 'field-note'}>{availability.text}</p>}
      <LanguagePackNote engineOrder={engineOrder} activeModel={activeModel} />
      <p className="lang-foot" id={footId}>
        Poradie zmeníte potiahnutím alebo klávesmi <kbd>Alt</kbd> + <kbd>↑</kbd> <kbd>↓</kbd>. Jazyk odoberiete krížikom alebo potiahnutím späť dole. {MEETINGS_LANGUAGE_NOTE}
      </p>
      {active !== null && <DragPreview drag={active} />}
    </div>
  );
}

type RowProps = { languages: LanguageSelection; activeModel: ModelInfo | null; engineOrder: readonly EngineId[] };

export function DictationLanguagesRow({ languages, activeModel, engineOrder }: RowProps) {
  const [pending, setPending] = useState<PendingSelection>(null);
  const effective = effectiveSelection(pending, languages);
  const server = liveValueOr(useServer(), null)?.server ?? null;
  const availability = serverAvailabilityNote(server, engineOrder, effective.selected);

  function save(next: LanguageSelection): void {
    setPending((current) => beginSave(current, next));
    saveSettings({ languages: next }, () => setPending((current) => settleSave(current)));
  }

  return (
    <SettingsRow id="languages" title="Jazyky diktovania" description={LANGUAGE_MODE_DESCRIPTIONS[effective.mode]}>
      <SegmentedControl label="Jazyky diktovania" options={languageModeOptions(activeModel?.languageHint ?? null)} value={effective.mode} onChange={(mode) => save({ ...effective, mode })} />
      {effective.mode === 'selected' && <LanguageBoard selected={effective.selected} activeModel={activeModel} engineOrder={engineOrder} availability={availability} onChange={(selected) => save({ mode: 'selected', selected })} />}
    </SettingsRow>
  );
}
