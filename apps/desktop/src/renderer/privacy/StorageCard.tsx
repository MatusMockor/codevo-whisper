import { useId } from 'react';
import { Glyph } from '../components/Glyph';
import type { NavTarget } from '../navigation';
import { HISTORY_RULES, STORED } from './privacy-copy';

const APP_FOLDER = '~/Library/Application Support/Codevo Whisper';

export function StorageCard({ onNavigate }: { onNavigate: (target: NavTarget) => void }) {
  const id = useId();
  return (
    <section className="last priv-card" aria-labelledby={id}>
      <div className="last-top">
        <h2 id={id}>
          <Glyph name="folder" size="sm" />
          Čo sa ukladá na tomto počítači
        </h2>
      </div>
      <p className="priv-folder">
        Všetko je v priečinku aplikácie <code>{APP_FOLDER}</code>
      </p>
      <ul className="files" aria-label="Uložené súbory">
        {STORED.map((item) => (
          <li key={item.where}>
            <span>{item.what}</span>
            <code>{item.where}</code>
          </li>
        ))}
      </ul>
      <details className="hint-more">
        <summary>Ako funguje história prepisov</summary>
        <ul className="priv-rules">
          {HISTORY_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </details>
      <div className="row-btns priv-actions">
        <button type="button" className="linkbtn" onClick={() => onNavigate({ page: 'home' })}>
          Otvoriť históriu na stránke Domov
        </button>
        <button type="button" className="linkbtn" onClick={() => onNavigate({ page: 'settings' })}>
          Vynulovať štatistiky v Nastaveniach
        </button>
      </div>
    </section>
  );
}
