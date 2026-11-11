import { Glyph } from '../components/Glyph';
import { PALETTE_KEYS } from '../palette/use-palette-shortcut';

type SettingsToolbarProps = { query: string; results: number | null; onQuery: (query: string) => void; onOpenPalette: () => void };

export function SettingsToolbar({ query, results, onQuery, onOpenPalette }: SettingsToolbarProps) {
  return (
    <div className="set-bar">
      <label className="set-search">
        <Glyph name="search" />
        <span className="visually-hidden">Hľadať v nastaveniach</span>
        <input
          type="search"
          value={query}
          placeholder="Hľadať v nastaveniach… napr. schránka, jazyk, AI"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query !== '') {
              event.preventDefault();
              onQuery('');
            }
          }}
        />
      </label>
      <span className="visually-hidden" role="status">
        {results === null ? '' : `Počet výsledkov: ${results}`}
      </span>
      <button type="button" className="btn" aria-keyshortcuts={PALETTE_KEYS.aria} onClick={onOpenPalette}>
        Paleta <kbd>{PALETTE_KEYS.label}</kbd>
      </button>
    </div>
  );
}
