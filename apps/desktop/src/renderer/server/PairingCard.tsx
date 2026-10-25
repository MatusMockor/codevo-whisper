import { useId, useState } from 'react';
import { PAIR_COMMAND, type PairingView, type VaultAvailability } from '../../shared/server';
import { CommandBox } from './CommandBox';
import { PAIRING_FAILURES } from './server-copy';

type PairingCardProps = { pairing: PairingView; storage: VaultAvailability; replacing: boolean };

function isBusy(pairing: PairingView): boolean {
  return pairing.kind === 'connecting' || pairing.kind === 'awaiting-approval';
}

function Progress({ pairing }: { pairing: PairingView }) {
  if (pairing.kind === 'connecting') {
    return <p className="note">Pripájam sa k serveru…</p>;
  }
  if (pairing.kind === 'awaiting-approval') {
    return (
      <div className="pair-wait">
        <div className="fp-box">
          <small>Odtlačok spojenia</small>
          <code data-fingerprint="connection">{pairing.connectionFingerprint}</code>
        </div>
        <p>
          Čaká sa na potvrdenie na serveri. Ak terminál ukazuje rovnaký odtlačok spojenia, odpovedzte na otázku <b>Spárovať toto zariadenie?</b> písmenom y. Zariadenie
          sa na serveri volá {pairing.deviceName}.
        </p>
        <button type="button" className="btn ghost" onClick={() => void window.codevo.cancelServerPairing()}>
          Zrušiť párovanie
        </button>
      </div>
    );
  }
  if (pairing.kind === 'paired') {
    return (
      <p className="pair-ok" role="status">
        Spárované. Server pozná tento Mac ako {pairing.deviceId}.
      </p>
    );
  }
  if (pairing.kind === 'failed') {
    return (
      <p className="field-note warn" role="alert">
        {PAIRING_FAILURES[pairing.failure]}
      </p>
    );
  }
  return <p className="note">Odtlačok sa zobrazí po pripojení k serveru.</p>;
}

export function PairingCard({ pairing, storage, replacing }: PairingCardProps) {
  const [token, setToken] = useState('');
  const tokenId = useId();
  const busy = isBusy(pairing);
  const blocked = storage !== 'available';

  function pair(): void {
    window.codevo.pairServer(token).catch((error: unknown) => console.error('Starting the pairing failed', error));
  }

  return (
    <div className="pair card">
      <h2>{replacing ? 'Spárovať nový server' : 'Spárovať server'}</h2>
      {replacing && <p className="note">Nové párovanie nahradí doterajšie.</p>}
      <ol className="steps">
        <li>
          <div>
            <p>Na serveri spustite príkaz</p>
            <CommandBox command={PAIR_COMMAND} />
            <p className="note">Príkaz otvorí párovacie okno na 10 minút a vypíše párovací token, ktorý začína cw1:.</p>
          </div>
        </li>
        <li>
          <div>
            <label htmlFor={tokenId}>
              <p>Vložte párovací token z terminálu</p>
            </label>
            <div className="token-in">
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
              <button type="button" className="btn primary" disabled={busy || blocked || token.trim() === ''} onClick={pair}>
                Spárovať
              </button>
            </div>
          </div>
        </li>
        <li>
          <div>
            <p>Porovnajte odtlačok spojenia s tým, čo ukazuje terminál, a potvrďte párovanie na serveri</p>
            <Progress pairing={pairing} />
          </div>
        </li>
      </ol>
    </div>
  );
}
