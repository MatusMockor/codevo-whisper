import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Glyph } from '../components/Glyph';
import { Highlight } from '../search/Highlight';
import { searchTerms } from '../search/text-match';
import { filterEntries, type PaletteEntry } from './palette-entries';

export type PaletteRequest = { query: string };

type CommandPaletteProps = { request: PaletteRequest | null; entries: readonly PaletteEntry[]; onClose: () => void; onRun: (entry: PaletteEntry) => void };

const STEPS: Partial<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

function optionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

type PaletteBodyProps = { initialQuery: string; entries: readonly PaletteEntry[]; onRun: (entry: PaletteEntry) => void };

function PaletteBody({ initialQuery, entries, onRun }: PaletteBodyProps) {
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);
  const terms = searchTerms(query);
  const matches = filterEntries(entries, terms);
  const current = Math.min(selected, matches.length - 1);

  useEffect(() => {
    document.getElementById(optionId(listId, current))?.scrollIntoView({ block: 'nearest' });
  }, [listId, current]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const step = STEPS[event.key];
    if (step !== undefined && matches.length > 0) {
      event.preventDefault();
      setSelected((current + step + matches.length) % matches.length);
      return;
    }
    const entry = matches[current];
    if (event.key === 'Enter' && entry !== undefined) {
      event.preventDefault();
      onRun(entry);
    }
  }

  return (
    <div className="pal-box">
      <div className="pal-in">
        <Glyph name="search" />
        <input
          type="text"
          role="combobox"
          aria-label="Prejsť na nastavenie alebo stránku"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={current >= 0 ? optionId(listId, current) : undefined}
          aria-autocomplete="list"
          placeholder="Prejsť na nastavenie alebo stránku…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd>esc</kbd>
      </div>
      <ul id={listId} className="pal-list" role="listbox" aria-label="Výsledky">
        {matches.map((entry, index) => (
          <li key={entry.id} id={optionId(listId, index)} role="option" aria-selected={index === current} onMouseMove={() => setSelected(index)} onClick={() => onRun(entry)}>
            <Glyph name={entry.icon} />
            <span className="pal-t">
              <Highlight text={entry.title} terms={terms} />
            </span>
            <span className="pal-g">{entry.group}</span>
          </li>
        ))}
      </ul>
      {matches.length === 0 && <p className="pal-empty">Nič sa nenašlo. Skúste iné slovo.</p>}
      <div className="pal-foot" aria-hidden="true">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> výber
        </span>
        <span>
          <kbd>↵</kbd> otvoriť
        </span>
        <span>
          <kbd>esc</kbd> zavrieť
        </span>
      </div>
    </div>
  );
}

export function CommandPalette({ request, entries, onClose, onRun }: CommandPaletteProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (request !== null && !element.open) {
      element.showModal();
      return;
    }
    if (request === null && element.open) {
      element.close();
    }
  }, [request]);

  return (
    <dialog
      ref={dialog}
      className="pal"
      aria-label="Príkazová paleta"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          event.currentTarget.close();
        }
      }}
    >
      {request !== null && (
        <PaletteBody
          initialQuery={request.query}
          entries={entries}
          onRun={(entry) => {
            dialog.current?.close();
            onRun(entry);
          }}
        />
      )}
    </dialog>
  );
}
