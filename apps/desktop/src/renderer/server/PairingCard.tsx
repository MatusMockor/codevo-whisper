import { useId, useState, type ReactNode } from 'react';
import type { PairingView, VaultAvailability } from '../../shared/server';
import { Glyph } from '../components/Glyph';
import { Led } from '../components/Led';
import { CommandBox } from './CommandBox';
import { PAIRING_FAILURES, pairingStep } from './server-copy';

type PairingCardProps = { pairing: PairingView; storage: VaultAvailability; replacing: boolean };

type StepState = 'cur' | 'done' | 'todo';

function isBusy(pairing: PairingView): boolean {
  return pairing.kind === 'connecting' || pairing.kind === 'awaiting-approval';
}

function stepStates(pairing: PairingView, hasToken: boolean): [StepState, StepState, StepState] {
  if (pairing.kind === 'awaiting-approval' || pairing.kind === 'paired') {
    return ['done', 'done', pairing.kind === 'paired' ? 'done' : 'cur'];
  }
  if (pairing.kind === 'connecting') {
    return ['done', 'done', 'cur'];
  }
  return hasToken ? ['done', 'cur', 'todo'] : ['cur', 'todo', 'todo'];
}

function Step({ number, state, title, children }: { number: string; state: StepState; title: ReactNode; children: ReactNode }) {
  return (
    <li className={`tstep ${state}`}>
      <div className="no" aria-hidden="true">
        {number}
        {state === 'done' && <Led state="ok" />}
      </div>
      <div>
        <h4>{title}</h4>
        {children}
      </div>
    </li>
  );
}

function Progress({ pairing }: { pairing: PairingView }) {
  if (pairing.kind === 'connecting') {
    return <p className="wait" role="status">Pripájam sa k serveru…</p>;
  }
  if (pairing.kind === 'awaiting-approval') {
    return (
      <>
        <div className="fps">
          <div className="fpbox hot">
            <small>Odtlačok spojenia</small>
            <code data-fingerprint="connection">{pairing.connectionFingerprint}</code>
          </div>
          <div className="fpbox">
            <small>Odtlačok zariadenia</small>
            <code data-fingerprint="device">{pairing.deviceFingerprint}</code>
          </div>
        </div>
        <p>
          Ak terminál ukazuje rovnaký odtlačok spojenia aj zariadenia, odpovedzte na otázku <b>Spárovať toto zariadenie?</b> písmenom y. Zariadenie sa na serveri volá {pairing.deviceName}.
        </p>
        <p className="wait" role="status">
          <i />
          <i />
          <i />
          Čaká sa na potvrdenie na serveri
        </p>
        <button type="button" className="tbtn" onClick={() => void window.codevo.cancelServerPairing()}>
          Zastaviť párovanie
        </button>
      </>
    );
  }
  if (pairing.kind === 'paired') {
    return (
      <p className="pair-ok" role="status">
        Spárované. Server pozná tento počítač ako {pairing.deviceId}.
      </p>
    );
  }
  if (pairing.kind === 'failed') {
    return (
      <p className="err" role="alert">
        <Glyph name="warn" size="sm" />
        {PAIRING_FAILURES[pairing.failure]}
      </p>
    );
  }
  return <p>Odtlačok sa zobrazí po pripojení k serveru.</p>;
}

export function PairingCard({ pairing, storage, replacing }: PairingCardProps) {
  const [token, setToken] = useState('');
  const tokenId = useId();
  const headingId = useId();
  const busy = isBusy(pairing);
  const blocked = storage !== 'available';
  const step = pairingStep(navigator.userAgent.includes('Linux'));
  const [first, second, third] = stepStates(pairing, token.trim() !== '');

  function pair(): void {
    window.codevo.pairServer(token).catch((error: unknown) => console.error('Starting the pairing failed', error));
  }

  return (
    <section className="term pair" aria-labelledby={headingId}>
      <div className="term-bar">
        <Glyph name="terminal" size="sm" />
        <h3 id={headingId}>{replacing ? 'Spárovať nový server' : 'Spárovať server'}</h3>
        <span className="term-steps">3 kroky</span>
        <Led state={busy ? 'warn' : 'off'} />
      </div>
      {replacing && <p className="term-note">Nové párovanie nahradí doterajšie.</p>}
      <ol className="tsteps">
        <Step number="01" state={first} title="Na serveri spustite príkaz">
          <CommandBox command={step.command} />
          <p>{step.note}</p>
        </Step>
        <Step number="02" state={second} title={<label htmlFor={tokenId}>Vložte párovací token z terminálu</label>}>
          <div className="tok">
            <textarea
              id={tokenId}
              aria-label="Párovací token"
              rows={2}
              spellCheck={false}
              autoComplete="off"
              placeholder="cw1:…"
              value={token}
              disabled={busy || blocked}
              onChange={(event) => setToken(event.target.value)}
            />
            <button type="button" className="tbtn primary" disabled={busy || blocked || token.trim() === ''} onClick={pair}>
              Spárovať
            </button>
          </div>
        </Step>
        <Step number="03" state={third} title="Porovnajte odtlačok spojenia s tým, čo ukazuje terminál, a potvrďte párovanie na serveri">
          <Progress pairing={pairing} />
        </Step>
      </ol>
    </section>
  );
}
