import { useState, type DragEvent, type ReactNode } from 'react';
import type { EngineId } from '../../shared/settings';
import { Glyph } from '../components/Glyph';
import { routeOutcome } from '../../shared/engine-routing';
import { Led } from '../components/Led';
import { SERVER_SECTION, type NavTarget } from '../navigation';
import { engineCard, type EngineCard, type EngineFacts } from './engine-cards';
import { droppedOrder, otherEngine, routeText, swapped, withFallback, withoutFallback, type RouteSlot } from './route-order';

type RouteCardProps = { order: readonly EngineId[]; facts: EngineFacts; onChange: (order: EngineId[]) => void; onNavigate: (target: NavTarget) => void };

const DRAG_TYPE = 'application/x-codevo-engine';

function isEngine(value: string): value is EngineId {
  return value === 'local' || value === 'server';
}

function EngineChip({ card, primary, onRemove }: { card: EngineCard; primary: boolean; onRemove?: () => void }) {
  return (
    <div
      className={primary ? 'eng primary' : 'eng'}
      draggable
      role="group"
      aria-label={`${card.title}, ${primary ? 'hlavný prepis' : 'záloha'}`}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, card.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <span className="grip" title="Potiahnite na zmenu poradia">
        <Glyph name="grip" />
      </span>
      <span className="ei">
        <Glyph name={card.id === 'server' ? 'server' : 'laptop'} />
      </span>
      <span className="t">
        <b>{card.title}</b>
        <span>{card.meta}</span>
      </span>
      <Led state={card.ready ? 'ok' : 'err'} />
      {onRemove !== undefined && (
        <button type="button" className="iconbtn" aria-label="Odobrať zálohu" onClick={onRemove}>
          <Glyph name="x" size="sm" />
        </button>
      )}
    </div>
  );
}

type SlotProps = { slot: RouteSlot; label: string; tag: string; tagTone: string; onDropEngine: (engine: EngineId, slot: RouteSlot) => void; children: ReactNode };

function Slot({ slot, label, tag, tagTone, onDropEngine, children }: SlotProps) {
  const [over, setOver] = useState(false);

  function drop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setOver(false);
    const engine = event.dataTransfer.getData(DRAG_TYPE);
    if (!isEngine(engine)) {
      return;
    }
    onDropEngine(engine, slot);
  }

  return (
    <div
      className={over ? 'slot over' : 'slot'}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <div className="sl">
        <span className="label-mono">{label}</span>
        <span className={`tag ${tagTone}`}>{tag}</span>
      </div>
      {children}
    </div>
  );
}

type EmptyFallbackProps = { primary: EngineId; facts: EngineFacts; serverAvailable: boolean; onAdd: () => void; onNavigate: (target: NavTarget) => void };

function addLabel(other: EngineId, facts: EngineFacts): string {
  if (other === 'local') {
    return 'Pridať lokálny prepis ako zálohu';
  }
  if (facts.server === null) {
    return 'Pridať server ako zálohu';
  }
  return `Pridať server ${facts.server.host} ako zálohu`;
}

function blockedServerNote(facts: EngineFacts): { text: string; action: string } {
  if (facts.server === null) {
    return { text: 'Server ako záloha bude dostupný po spárovaní.', action: 'Spárovať server' };
  }
  if (!facts.server.enabled) {
    return { text: 'Server je odpojený. Po pripojení ho môžete pridať ako zálohu.', action: 'Zobraziť server' };
  }
  return { text: 'Server treba znova spárovať, až potom ho môžete pridať ako zálohu.', action: 'Spárovať znova' };
}

function EmptyFallback({ primary, facts, serverAvailable, onAdd, onNavigate }: EmptyFallbackProps) {
  const other = otherEngine(primary);
  if (other === 'server' && !serverAvailable) {
    const note = blockedServerNote(facts);
    return (
      <div className="emptyslot">
        <span>{note.text}</span>
        <button type="button" className="linkbtn" onClick={() => onNavigate(SERVER_SECTION)}>
          {note.action}
        </button>
      </div>
    );
  }
  return (
    <div className="emptyslot">
      <span>Bez zálohy. Keď {primary === 'server' ? 'server neodpovedá' : 'model nie je pripravený'}, diktovanie zlyhá.</span>
      <button type="button" className="btn sm" onClick={onAdd}>
        <Glyph name="plus" size="sm" />
        {addLabel(other, facts)}
      </button>
    </div>
  );
}

export function RouteCard({ order, facts, onChange, onNavigate }: RouteCardProps) {
  const serverAvailable = facts.conditions.serverReady;
  const flowing = routeOutcome(order, facts.conditions).engine !== null;
  const [primaryId = 'local', fallbackId] = order;
  const primary = engineCard(primaryId, facts);
  const fallback = fallbackId === undefined ? null : engineCard(fallbackId, facts);
  const text = routeText(order);

  function dropEngine(engine: EngineId, slot: RouteSlot): void {
    const next = droppedOrder(order, engine, slot, serverAvailable);
    if (next === null) {
      return;
    }
    onChange(next);
  }

  return (
    <div className="card route-card">
      <div className="route">
        <Slot slot={0} label="1 · Hlavný prepis" tag="používa sa" tagTone="amber" onDropEngine={dropEngine}>
          <EngineChip card={primary} primary />
        </Slot>
        <div className="route-mid">
          <span className={flowing ? 'wire on' : 'wire dead'} aria-hidden="true" />
          <button type="button" className="iconbtn" aria-label="Vymeniť hlavný prepis a zálohu" disabled={fallback === null} onClick={() => onChange(swapped(order))}>
            <Glyph name="swap" size="sm" />
          </button>
        </div>
        <Slot slot={1} label="2 · Záloha" tag={fallback === null ? 'voliteľné' : 'ak hlavný nie je dostupný'} tagTone="" onDropEngine={dropEngine}>
          {fallback === null ? (
            <EmptyFallback primary={primaryId} facts={facts} serverAvailable={serverAvailable} onAdd={() => onChange(withFallback(order))} onNavigate={onNavigate} />
          ) : (
            <EngineChip card={fallback} primary={false} onRemove={() => onChange(withoutFallback(order))} />
          )}
        </Slot>
      </div>
      <div className="route-foot">
        <p>
          Trasa: <b>{text.title}</b>. {text.detail}
        </p>
        <span className="label-mono">platí od ďalšieho diktovania</span>
      </div>
    </div>
  );
}
