import { useId } from 'react';
import { Glyph } from '../components/Glyph';
import { Led } from '../components/Led';
import type { NavTarget } from '../navigation';
import type { ZoneCopy } from './privacy-copy';
import type { ZoneState } from './privacy-zones';

type ZoneProps = { copy: ZoneCopy; state: ZoneState; onNavigate: (target: NavTarget) => void };

function ZoneFoot({ state, onNavigate }: { state: ZoneState; onNavigate: (target: NavTarget) => void }) {
  const { status, action } = state;
  if (status === null && action === null) {
    return null;
  }
  return (
    <footer className="zone-foot">
      {status !== null && (
        <span className="zone-status">
          <Led state={status.tone} />
          {status.label}
        </span>
      )}
      {action !== null && (
        <button type="button" className="linkbtn" onClick={() => onNavigate(action.target)}>
          {action.label}
        </button>
      )}
    </footer>
  );
}

export function Zone({ copy, state, onNavigate }: ZoneProps) {
  const id = useId();
  return (
    <section className={`zone zone-${copy.id}`} aria-labelledby={id}>
      <header className="zone-head">
        <span className="zone-ic">
          <Glyph name={copy.icon} />
        </span>
        <div>
          <h2 id={id}>{copy.title}</h2>
          <p className="zone-scope">{copy.scope}</p>
        </div>
      </header>
      <ol className="minipath" aria-label="Cesta dát">
        {state.path.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <ul className="zone-facts">
        {copy.facts.map((fact) => (
          <li key={fact.text} className={fact.icon === 'warn' ? 'warn' : undefined}>
            <Glyph name={fact.icon} size="sm" />
            {fact.text}
          </li>
        ))}
      </ul>
      <ZoneFoot state={state} onNavigate={onNavigate} />
    </section>
  );
}
